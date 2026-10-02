import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArticleUrl, articleSource, articleSelectors, cleanArticleText } from "../reader-core.mjs";

test("validates public article URLs and removes fragments", () => {
  assert.equal(normalizeArticleUrl(" https://www.bbc.co.uk/news/articles/example#story "), "https://www.bbc.co.uk/news/articles/example");
  assert.throws(() => normalizeArticleUrl("javascript:alert(1)"));
  assert.throws(() => normalizeArticleUrl("http://127.0.0.1/private"));
});

test("uses article paragraphs for each supported newspaper", () => {
  assert.equal(articleSource("https://e.vnexpress.net/news/story.html"), "VnExpress International");
  assert.equal(articleSelectors("https://vietnamnews.vn/society/story.html")[0], "#abody p");
  assert.equal(articleSelectors("https://www.bbc.co.uk/news/story")[0], "article p");
  assert.equal(articleSelectors("https://vnexpress.net/story.html")[0], ".fck_detail > p.Normal");
});

test("keeps article paragraph boundaries and removes ad labels", () => {
  assert.equal(cleanArticleText(" First sentence. \r\nSecond sentence.\nAdvertisement\nThird sentence."), "First sentence.\n\nSecond sentence.\n\nThird sentence.");
});
