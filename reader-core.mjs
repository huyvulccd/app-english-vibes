// URL handling and plain-text cleanup for articles fetched in the browser.
export function normalizeArticleUrl(input) {
  let url;
  try { url = new URL(String(input || "").trim()); }
  catch { throw new Error("Link bài báo không hợp lệ. Hãy dán URL đầy đủ bắt đầu bằng https://."); }
  const host = url.hostname.toLowerCase();
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !host.includes(".") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || String(input).length > 3000) {
    throw new Error("Chỉ dùng link bài báo công khai dạng http:// hoặc https://.");
  }
  url.hash = "";
  return url.href;
}

export function articleSource(url) {
  const host = new URL(url).hostname.toLowerCase();
  const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (matches("bbc.co.uk") || matches("bbc.com")) return "BBC News";
  if (matches("vietnamnews.vn")) return "Viet Nam News";
  if (host === "e.vnexpress.net") return "VnExpress International";
  if (matches("vnexpress.net")) return "VnExpress";
  return host.replace(/^www\./, "");
}

export function articleSelectors(url) {
  const source = articleSource(url);
  if (source === "BBC News") return ["article p", "main p"];
  if (source === "Viet Nam News") return ["#abody p", "article p, main p"];
  if (source === "VnExpress International" || source === "VnExpress") return [".fck_detail > p.Normal", ".fck_detail p", "article p, main p"];
  return ["article p, main p", "[role=main] p, .article-content p, .entry-content p"];
}

export function cleanArticleText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^(advertisement|quảng cáo|read more|share|save)$/i.test(line))
    .join("\n\n");
}
