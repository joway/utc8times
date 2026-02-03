import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_CSV_URL =
  "https://raw.githubusercontent.com/timqian/chinese-independent-blogs/master/blogs-original.csv";

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const PAGES_DIR = path.join(PUBLIC_DIR, "pages");
const DB_PATH = path.join(DATA_DIR, "db.csv");

const PAGE_SIZE = 20;
const FETCH_CONCURRENCY = 100;

const parser = new Parser({
  customFields: {
    item: [
      "published",
      "updated",
      "modified",
      "issued",
      "created",
      "published_at",
      "updated_at",
      "dc:date",
      "dcterms:modified",
      "dcterms:issued",
      "dcterms:created",
      "atom:published",
      "atom:updated",
    ],
  },
});
const RSS_TIMEOUT_MS = 30000;
const ARTICLE_LINK_BLACKLIST = [
  // "https://example.com/bad-article",
];
const EXTRA_SOURCES = [
  // {
  //   rsslink: "https://example.com/feed.xml",
  //   blogname: "Example Blog",
  //   homepage: "https://example.com",
  // },
];
const RSS_DOMAIN_BLACKLIST = [
  "lukefan.com",
  "www.yystv.cn",
  "www.wikimoe.com",
  "www.cheshirex.com",
  "ednovas.xyz",
  "masuit.net",
  "masuit.com",
  "www.changhai.org",
  "www.coderli.com",
  "mathpretty.com",
  "qiangwaikan.com",
  "zelikk.blogspot.com",
  "51.ruyo.net",
];

const isDryRun = process.argv.includes("--dry-run");
const isRebuild = process.argv.includes("--rebuild");

function sampleSources(sources, ratio) {
  if (ratio >= 1 || sources.length === 0) return sources;
  const count = Math.max(1, Math.floor(sources.length * ratio));
  const shuffled = [...sources];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickFirstLink(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
  }
  return "";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeDateValue(value) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeDateValue(entry);
      if (normalized) return normalized;
    }
    return "";
  }
  if (typeof value === "object") {
    if (value.value) return normalizeDateValue(value.value);
    if (value._) return normalizeDateValue(value._);
    if (value["#text"]) return normalizeDateValue(value["#text"]);
  }
  return "";
}

function extractItemDate(item) {
  const candidates = [
    item.isoDate,
    item.pubDate,
    item.published,
    item.updated,
    item.created,
    item.modified,
    item.issued,
    item.date,
    item["dc:date"],
    item["dcterms:modified"],
    item["dcterms:issued"],
    item["dcterms:created"],
    item["atom:published"],
    item["atom:updated"],
    item.published_at,
    item.updated_at,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDateValue(candidate);
    if (!normalized) continue;
    const parsed = parseDate(normalized);
    if (parsed) return parsed;
  }
  return null;
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return String(value);
  } catch {
    return "";
  }
}

function normalizeLink(...values) {
  const queue = [...values];
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value) continue;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    if (typeof value === "object") {
      if (value.href) queue.push(value.href);
      if (value.url) queue.push(value.url);
      if (value.link) queue.push(value.link);
      if (value.value) queue.push(value.value);
      if (value.id) queue.push(value.id);
      continue;
    }

    const coerced = safeString(value).trim();
    if (coerced) return coerced;
  }
  return "";
}

function getHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(PAGES_DIR, { recursive: true });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "utc8times-bot" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function extractRssSources(records) {
  const sources = [];

  for (const record of records) {
    const keys = Object.keys(record);
    const headerMap = new Map(
      keys.map((key) => [normalizeHeader(key), key])
    );

    const rssKey =
      headerMap.get("rss") ||
      headerMap.get("rss link") ||
      headerMap.get("rss feed") ||
      headerMap.get("rsslink") ||
      headerMap.get("feed") ||
      headerMap.get("feed link") ||
      headerMap.get("feedlink");

    const introKey =
      headerMap.get("introduction") ||
      headerMap.get("intro") ||
      headerMap.get("name") ||
      headerMap.get("blogname") ||
      headerMap.get("blog name") ||
      headerMap.get("title");

    const linkKey =
      headerMap.get("link") ||
      headerMap.get("website") ||
      headerMap.get("url");

    const rsslink = pickFirstLink(
      rssKey ? record[rssKey] : "",
      record["RSS"],
      record["rss"],
      record["rsslink"],
      record["feed"],
      record["Feed"],
      record["Feed Link"]
    );

    if (!rsslink) continue;

    const blogname =
      (introKey && record[introKey]) ||
      record["Introduction"] ||
      record["intro"] ||
      record["name"] ||
      record["Blog"] ||
      record["Title"] ||
      record["Blog Name"] ||
      rsslink;

    const homepage = pickFirstLink(
      linkKey ? record[linkKey] : "",
      record["Link"],
      record["Website"],
      record["URL"]
    );

    sources.push({
      rsslink,
      blogname: String(blogname || "").trim(),
      homepage,
    });
  }

  const seen = new Set();
  return sources.filter((source) => {
    if (!source.rsslink) return false;
    const key = source.rsslink.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadDb() {
  try {
    const content = await fs.readFile(DB_PATH, "utf8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function formatDate(date) {
  return date.toISOString();
}

async function fetchFeed(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);

  try {
    const response = await fetch(source.rsslink, {
      headers: { "user-agent": "utc8times-bot" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xml = await response.text();
    const feed = await parser.parseString(xml);
    return { source, feed };
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn(`Timeout after ${RSS_TIMEOUT_MS / 1000}s: ${source.rsslink}`);
    } else {
      console.warn(`Failed to fetch RSS: ${source.rsslink} (${error.message})`);
    }
    return { source, error };
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithConcurrency(items, limit, task, onProgress) {
  const results = [];
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await task(items[current]);
      done += 1;
      if (onProgress) onProgress(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

function buildRow({
  id,
  title,
  link,
  rsslink,
  blogname,
  createdat,
  crawledat,
}) {
  return {
    id: safeString(id).trim(),
    title: safeString(title).trim(),
    link: safeString(link).trim(),
    rsslink: safeString(rsslink).trim(),
    blogname: safeString(blogname).trim(),
    createdat: createdat ? formatDate(createdat) : "",
    crawledat: crawledat ? formatDate(crawledat) : "",
  };
}

function buildPages(records) {
  const pages = [];
  for (let i = 0; i < records.length; i += PAGE_SIZE) {
    pages.push(records.slice(i, i + PAGE_SIZE));
  }
  return pages;
}

async function writePages(records) {
  const now = new Date();
  const futureCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const validRecords = records.filter((row) => {
    if (!row.createdat || !String(row.createdat).trim()) return false;
    if (
      ARTICLE_LINK_BLACKLIST.length > 0 &&
      ARTICLE_LINK_BLACKLIST.includes(String(row.link || "").trim())
    ) {
      return false;
    }
    const created = parseDate(row.createdat);
    if (!created) return false;
    return created.getTime() <= futureCutoff.getTime();
  });
  const pages = buildPages(validRecords);
  const totalPages = pages.length || 1;

  await fs.rm(PAGES_DIR, { recursive: true, force: true });
  await fs.mkdir(PAGES_DIR, { recursive: true });

  for (let i = 0; i < totalPages; i += 1) {
    const pageNumber = i + 1;
    const items = pages[i] || [];
    const payload = {
      page: pageNumber,
      pageSize: PAGE_SIZE,
      totalPages,
      items,
    };
    const filePath = path.join(PAGES_DIR, `page${pageNumber}.json`);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

async function writeDb(records) {
  const csv = stringify(records, {
    header: true,
    columns: [
      "id",
      "title",
      "link",
      "rsslink",
      "blogname",
      "createdat",
      "crawledat",
    ],
  });
  await fs.writeFile(DB_PATH, csv, "utf8");
}

function sortByLatest(records) {
  return [...records].sort((a, b) => {
    const dateA = parseDate(a.createdat) || parseDate(a.crawledat) || new Date(0);
    const dateB = parseDate(b.createdat) || parseDate(b.crawledat) || new Date(0);
    return dateB.getTime() - dateA.getTime();
  });
}

function sortByOldest(records) {
  return [...records].sort((a, b) => {
    const dateA = parseDate(a.createdat) || parseDate(a.crawledat) || new Date(0);
    const dateB = parseDate(b.createdat) || parseDate(b.crawledat) || new Date(0);
    return dateA.getTime() - dateB.getTime();
  });
}

async function main() {
  await ensureDirs();

  const sourceCsv = await fetchText(SOURCE_CSV_URL);
  const sourceRecords = parse(sourceCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  let sources = extractRssSources(sourceRecords);
  if (EXTRA_SOURCES.length > 0) {
    const extra = EXTRA_SOURCES.map((source) => ({
      rsslink: safeString(source.rsslink).trim(),
      blogname: safeString(source.blogname).trim(),
      homepage: safeString(source.homepage).trim(),
    })).filter((source) => source.rsslink);
    sources = [...sources, ...extra];
  }
  if (RSS_DOMAIN_BLACKLIST.length > 0) {
    sources = sources.filter((source) => {
      const hostname = getHostname(source.rsslink);
      return hostname && !RSS_DOMAIN_BLACKLIST.includes(hostname);
    });
  }
  if (isDryRun) {
    const sampled = sampleSources(sources, 0.01);
    console.log(
      `Dry run enabled: sampling ${sampled.length}/${sources.length} RSS feeds.`
    );
    sources = sampled;
  }
  const existingDb = isRebuild ? [] : await loadDb();
  const existingLinks = new Set(
    existingDb.map((row) => String(row.link || "").trim())
  );

  const crawledAt = new Date();

  let lastPercent = -1;
  const feedResults = await runWithConcurrency(
    sources,
    FETCH_CONCURRENCY,
    fetchFeed,
    (done, total) => {
      const percent = total === 0 ? 100 : Math.floor((done / total) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        console.log(`Fetching RSS feeds... ${percent}% (${done}/${total})`);
      }
    }
  );

  const newRows = [];
  for (const result of feedResults) {
    if (!result || result.error || !result.feed) continue;
    const { source, feed } = result;
    const items = Array.isArray(feed.items) ? feed.items : [];

    for (const item of items) {
      const link = normalizeLink(
        item.link,
        item.guid,
        item.id,
        item.url,
        item.links,
        item.enclosure,
        item.enclosures
      );
      if (!link) continue;
      const linkKey = safeString(link).trim();
      if (existingLinks.has(linkKey)) continue;

      const createdAt = extractItemDate(item);

      const row = buildRow({
        id: "",
        title: safeString(item.title || feed.title || link),
        link: linkKey,
        rsslink: source.rsslink,
        blogname: safeString(source.blogname || feed.title || source.rsslink),
        createdat: createdAt,
        crawledat: crawledAt,
      });

      existingLinks.add(linkKey);
      newRows.push(row);
    }
  }

  const currentId = existingDb.length
    ? Math.max(...existingDb.map((row) => Number(row.id) || 0))
    : 0;

  let nextId = currentId;
  const merged = [...existingDb, ...newRows].map((row) => {
    const numericId = Number(row.id);
    if (Number.isFinite(numericId) && numericId > 0) {
      return { ...row, id: String(numericId) };
    }
    nextId += 1;
    return { ...row, id: String(nextId) };
  });

  const sorted = sortByLatest(merged);
  let outputRecords = sorted;
  if (isRebuild) {
    const chronological = sortByOldest(sorted);
    const idMap = new Map();
    chronological.forEach((row, index) => {
      idMap.set(row.link, String(index + 1));
    });
    outputRecords = sorted.map((row) => ({
      ...row,
      id: idMap.get(row.link) || row.id,
    }));
  }
  const dbRecords = [...outputRecords].sort(
    (a, b) => Number(a.id) - Number(b.id)
  );
  if (!isDryRun) {
    await writeDb(dbRecords);
    await writePages(outputRecords);
  } else {
    console.log("Dry run: skip writing db.csv and page json files.");
  }

  console.log(
    `Fetched ${sources.length} RSS feeds. New items: ${newRows.length}. Total: ${sorted.length}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
