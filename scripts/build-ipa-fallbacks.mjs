// Supplement missing IPA with English Wiktionary pronunciations for the static deck.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deck = JSON.parse(await readFile(path.join(root, "vocabulary-data.json"), "utf8"));
const destination = path.join(root, "ipa-fallbacks.json");
let cached = {};
try { cached = JSON.parse(await readFile(destination, "utf8")).items || {}; } catch { /* first build */ }
const words = [...new Set(deck.cards.filter((card) => !card.ipa && !cached[card.word]).map((card) => card.word))];
const items = { ...cached };
let found = 0;
for (let start = 0; start < words.length; start += 45) {
  const batch = words.slice(start, start + 45);
  const query = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "revisions", rvprop: "content", rvslots: "main", titles: batch.join("|") });
  const response = await fetch(`https://en.wiktionary.org/w/api.php?${query}`, {
    headers: { "User-Agent": "SayBack/1.0 (https://github.com/huyvulccd/app-english-vibes)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Wiktionary HTTP ${response.status}`);
  const data = await response.json();
  for (const page of data.query?.pages || []) {
    const word = page.title?.toLowerCase();
    if (!batch.includes(word)) continue;
    const source = page.revisions?.[0]?.slots?.main?.content || "";
    const english = source.match(/^==English==\s*([\s\S]*?)(?=^==[^=]|$(?![\s\S]))/m)?.[1] || "";
    const templates = [...english.matchAll(/\{\{IPA\|en\|([^{}]+)\}\}/g)];
    const values = templates.flatMap((match) => match[1].split("|").map((part) => part.trim()));
    const ipa = values.find((value) => /^\/.+\/$/.test(value) && value.length < 90 && !/[{}<>]/.test(value));
    if (!ipa) continue;
    items[word] = ipa;
    found++;
  }
  console.log(`Wiktionary IPA: ${Math.min(start + batch.length, words.length)}/${words.length}, found ${found}`);
}
await writeFile(destination, JSON.stringify({ source: "https://en.wiktionary.org/", license: "CC BY-SA 4.0", items }, null, 2) + "\n", "utf8");
console.log(`Saved ${Object.keys(items).length} IPA fallbacks`);
