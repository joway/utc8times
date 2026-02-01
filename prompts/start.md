我想要实现一个叫做「UTC+8 Times」的类似纽约时报的新闻网站。

## 技术架构：

### 数据源

从 https://github.com/timqian/chinese-independent-blogs/blob/master/blogs-original.csv 中，抓取所有存在 RSS feed 的博客。

### 定时任务

使用 github action ，每 60 分钟对所有 RSS feed 源进行一次抓取，对比本地数据库，有更新则插入新数据。 

### 数据库

本地存储一个 CSV 文件，每一列的名字和定义如下：
- id: 自增 id ，从 1 开始
- title: 文章名字
- link: 文章链接
- rsslink: rss 来源链接
- blogname: 博客名字，即数据源中的 Introduction 列内容
- createdat: rss 链接中抓取到的文章创建时间，如果抓取不到创建时间，就留空
- cralwedat: 工具抓取的时间

## 网页设计

要求：
- 设计风格参考纽约时报，黑白风格
- 响应式布局，屏幕大的时候显示左右双栏，屏幕小的时候显示单栏
- 每一栏里，从左到右依次显示：[blogname] title        createdat
- 每一栏中最多有 20 行条记录
- 不要使用前端框架，使用最简单的 JS 并且配合 tailwind 实现。

## 接口设计

由于我希望保持架构简洁，不希望额外引入数据库，所以我需要你每次爬虫结束，构建完数据库后，使用一个脚本生成分页接口所需的全部 json 文件。

例如:
page1.json
page2.json
page3.json
...

每一个 json 文件有最多 20 条记录，最前面的 page 有最新的记录。

这样，当我的网页在一开始的时候，如果是双栏布局，则加载 page1.json 就可以渲染最新的博客更新记录。
