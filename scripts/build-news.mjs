// Refresh short practice passages from publishers' public RSS feeds.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "news-data.json");
const feeds = [
  { source: "BBC News", language: "en", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC News", language: "en", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "Viet Nam News", language: "en", url: "https://vietnamnews.vn/rss/society.rss" },
  { source: "Viet Nam News", language: "en", url: "https://vietnamnews.vn/rss/economy.rss" },
  { source: "Viet Nam News", language: "en", url: "https://vietnamnews.vn/rss/world.rss" },
  { source: "VnExpress International", language: "en", url: "https://e.vnexpress.net/rss/news.rss" },
  { source: "VnExpress International", language: "en", url: "https://e.vnexpress.net/rss/life.rss" },
  { source: "VnExpress", language: "vi", url: "https://vnexpress.net/rss/tin-moi-nhat.rss" },
  { source: "VnExpress", language: "vi", url: "https://vnexpress.net/rss/khoa-hoc-cong-nghe.rss" },
];
const replaceEntities = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  if (entity[0] === "#") {
    const number = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : " ";
  }
  return named[entity.toLowerCase()] || " ";
});
function clean(value) {
  return replaceEntities(String(value || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "";
}
function feedItems(xml, feed) {
  const results = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = clean(tag(item, "title"));
    const summary = clean(tag(item, "description"));
    const url = clean(tag(item, "link"));
    const date = clean(tag(item, "pubDate"));
    if (!title || !/^https:\/\//.test(url) || !summary || /^(home|news)$/i.test(title)) continue;
    const text = `${title.replace(/[.!?]$/, "")}. ${summary}`.replace(/\s+/g, " ").trim();
    if (text.length < 70 || text.length > 900) continue;
    results.push({
      id: createHash("sha1").update(url).digest("hex").slice(0, 14),
      source: feed.source, language: feed.language, title, summary,
      text, url, date: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
    });
  }
  return results.slice(0, 20);
}
async function download(feed) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(feed.url, { headers: { "User-Agent": "SayBack-RSS-reader/1.0", Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const raw = new Uint8Array(bytes);
      const utf16 = (raw[0] === 0xff && raw[1] === 0xfe) || raw.slice(0, 100).filter((byte) => byte === 0).length > 20;
      const xml = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(bytes);
      const items = feedItems(xml, feed);
      if (!items.length) throw new Error("No usable items");
      console.log(`${feed.source} / ${feed.url.split("/").at(-1)}: ${items.length}`);
      return items;
    } catch (error) {
      if (attempt === 3) { console.warn(`${feed.url}: ${error.message}`); return []; }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
const all = (await Promise.all(feeds.map(download))).flat();
const seen = new Set();
const items = all.filter((item) => {
  if (seen.has(item.url)) return false;
  seen.add(item.url);
  return true;
}).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const counts = Object.fromEntries([...new Set(feeds.map((feed) => feed.source))].map((source) => [source, items.filter((item) => item.source === source).length]));
if (items.filter((item) => item.language === "en").length < 15 || items.filter((item) => item.language === "vi").length < 10) {
  throw new Error(`Not enough RSS passages: ${JSON.stringify(counts)}`);
}
let previous;
try { previous = JSON.parse(await readFile(destination, "utf8")); } catch { /* first build */ }
const previousIds = previous?.items?.map((item) => item.id).sort().join(",");
const currentIds = items.map((item) => item.id).sort().join(",");
if (previousIds === currentIds) {
  console.log(`No new stories; keeping ${previous.items.length} existing passages`);
} else {
  await writeFile(destination, JSON.stringify({ generatedAt: new Date().toISOString(), counts, feeds, items }) + "\n", "utf8");
  console.log(`Wrote ${items.length} passages: ${JSON.stringify(counts)}`);
}
