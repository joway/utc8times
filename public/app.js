const PAGE_SIZE = 20;
const VISITED_KEY = "utc8times:visited";
const pageIndicator = document.getElementById("page-indicator");
const pageIndicatorTop = document.getElementById("page-indicator-top");
const pagePrev = document.getElementById("page-prev");
const pageNext = document.getElementById("page-next");

const leftColumn = document.getElementById("column-left");
const rightColumn = document.getElementById("column-right");
const lastUpdated = document.getElementById("last-updated");

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function pickLatestDate(items, field) {
  let latest = null;
  for (const item of items) {
    const value = item?.[field];
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function renderItem(item) {
  const row = document.createElement("div");
  row.className = "item-row";

  const blog = document.createElement("div");
  blog.className = "item-blog";
  blog.textContent = item.blogname || "";

  const title = document.createElement("div");
  title.className = "item-title";
  const link = document.createElement("a");
  link.href = item.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.title || item.link || "Untitled";
  if (link.href && visitedLinks.has(link.href)) {
    link.classList.add("is-visited");
  }
  link.addEventListener("click", () => {
    if (!link.href) return;
    visitedLinks.add(link.href);
    saveVisitedLinks();
    link.classList.add("is-visited");
  });
  title.appendChild(link);

  const date = document.createElement("div");
  date.className = "item-date";
  date.textContent = formatDate(item.createdat);

  row.appendChild(blog);
  row.appendChild(title);
  row.appendChild(date);

  return row;
}

function loadVisitedLinks() {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch {
    return new Set();
  }
  return new Set();
}

function saveVisitedLinks() {
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...visitedLinks]));
  } catch {
    // Ignore storage failures (private mode).
  }
}

function renderColumns(items) {
  const isWide = window.matchMedia("(min-width: 1024px)").matches;

  leftColumn.innerHTML = "";
  rightColumn.innerHTML = "";

  if (isWide) {
    rightColumn.classList.remove("hidden");
    const leftItems = [];
    const rightItems = [];
    items.slice(0, PAGE_SIZE).forEach((item, index) => {
      if (index % 2 === 0) {
        leftItems.push(item);
      } else {
        rightItems.push(item);
      }
    });

    leftItems.forEach((item) => leftColumn.appendChild(renderItem(item)));
    rightItems.forEach((item) => rightColumn.appendChild(renderItem(item)));
  } else {
    rightColumn.classList.add("hidden");
    items.slice(0, PAGE_SIZE).forEach((item) => {
      leftColumn.appendChild(renderItem(item));
    });
  }
}

function getPageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function setPageInUrl(page) {
  const params = new URLSearchParams(window.location.search);
  params.set("page", String(page));
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", nextUrl);
}

function updatePager(page, totalPages) {
  const label = `Page ${page} / ${totalPages}`;
  pageIndicator.textContent = label;
  if (pageIndicatorTop) pageIndicatorTop.textContent = label;
  pagePrev.disabled = page <= 1;
  pageNext.disabled = page >= totalPages;
  pagePrev.classList.toggle("opacity-40", pagePrev.disabled);
  pageNext.classList.toggle("opacity-40", pageNext.disabled);
}

async function loadPage(page = 1) {
  try {
    const response = await fetch(`/pages/page${page}.json`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch page ${page}`);
    }
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    renderColumns(items);
    const totalPages = Number(data.totalPages) || 1;
    updatePager(page, totalPages);
    setPageInUrl(page);

    const latestCrawled = pickLatestDate(items, "crawledat");
    if (latestCrawled) {
      const timeLabel = formatDate(latestCrawled);
      lastUpdated.textContent = timeLabel
        ? `Last update: ${timeLabel}`
        : "Latest update ready";
    } else {
      lastUpdated.textContent = "No updates yet";
    }
  } catch (error) {
    console.error(error);
    lastUpdated.textContent = "Failed to load latest updates";
  }
}

window.addEventListener("resize", () => {
  const cards = document.querySelectorAll(".item-row");
  if (cards.length === 0) return;
  loadPage(getPageFromUrl());
});

pagePrev.addEventListener("click", () => {
  const page = getPageFromUrl();
  if (page > 1) loadPage(page - 1);
});

pageNext.addEventListener("click", () => {
  const page = getPageFromUrl();
  loadPage(page + 1);
});

const visitedLinks = loadVisitedLinks();

loadPage(getPageFromUrl());
