// Build a compact B1–C2 deck from CEFR-J/Octanove and the open thichhoc dictionary.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, "SOURCE", "vocabulary-cache");
const destination = path.join(root, "vocabulary-data.json");
const levels = ["B1", "B2", "C1", "C2"];
const cefrRepo = "openlanguageprofiles/olp-en-cefrj";
const dictRepo = "thichhoc-org/thichhoc-dict";
const headers = { "User-Agent": "SayBack-vocabulary-builder", Accept: "application/vnd.github+json" };
await mkdir(cache, { recursive: true });

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function getText(url, key) {
  const file = path.join(cache, `${createHash("sha256").update(key).digest("hex")}.txt`);
  try { return await readFile(file, "utf8"); } catch { /* download once */ }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const text = await response.text();
      await writeFile(file, text, "utf8");
      return text;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
function csvRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function posKey(value) {
  const pos = String(value).toLowerCase();
  if (/^(n|noun)/.test(pos)) return "noun";
  if (/^(v|verb)/.test(pos)) return "verb";
  if (/^(adj|adjective)/.test(pos)) return "adjective";
  if (/^(adv|adverb)/.test(pos)) return "adverb";
  return pos;
}
const revisions = await Promise.all([
  json(`https://api.github.com/repos/${cefrRepo}/commits/master`),
  json(`https://api.github.com/repos/${dictRepo}/commits/main`),
]);
const cefrSha = revisions[0].sha;
const dictSha = revisions[1].sha;
const lists = await Promise.all([
  getText(`https://raw.githubusercontent.com/${cefrRepo}/${cefrSha}/cefrj-vocabulary-profile-1.5.csv`, `${cefrSha}:cefrj`),
  getText(`https://raw.githubusercontent.com/${cefrRepo}/${cefrSha}/octanove-vocabulary-profile-c1c2-1.0.csv`, `${cefrSha}:octanove`),
]);
const targets = new Map();
for (const list of lists) {
  const [header, ...rows] = csvRows(list);
  const wordColumn = header.indexOf("headword"), posColumn = header.indexOf("pos"), levelColumn = header.indexOf("CEFR");
  if (wordColumn < 0 || levelColumn < 0) throw new Error("Unexpected CEFR CSV header");
  for (const row of rows) {
    const word = row[wordColumn]?.trim().toLowerCase();
    const level = row[levelColumn]?.trim().toUpperCase();
    if (!levels.includes(level) || !/^[a-z][a-z'-]{2,29}$/.test(word || "")) continue;
    const old = targets.get(word);
    if (!old || levels.indexOf(level) < levels.indexOf(old.level)) targets.set(word, { word, level, pos: posKey(row[posColumn]) });
  }
}
console.log(`CEFR source: ${targets.size} distinct B1–C2 words`);

const tree = await json(`https://api.github.com/repos/${dictRepo}/git/trees/${dictSha}?recursive=1`);
const shards = tree.tree.filter((entry) => entry.path.startsWith("dict-en-vi/data/entries/") && entry.path.endsWith(".jsonl"));
if (shards.length < 80) throw new Error(`Expected dictionary shards, found ${shards.length}`);
const matches = new Map();
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < shards.length) {
    const shard = shards[cursor++];
    const data = await getText(`https://raw.githubusercontent.com/${dictRepo}/${dictSha}/${shard.path}`, `${dictSha}:${shard.path}`);
    for (const line of data.split(/\r?\n/)) {
      if (!line) continue;
      const entry = JSON.parse(line);
      const word = entry.headword?.toLowerCase();
      if (!targets.has(word) || !Array.isArray(entry.senses_vi)) continue;
      const meaning = entry.senses_vi.find((value) => typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 160)?.trim();
      if (!meaning) continue;
      const english = [...(Array.isArray(entry.senses_en) ? entry.senses_en : []), ...(Array.isArray(entry.gloss_en) ? entry.gloss_en : [])]
        .filter((value) => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length >= 3 && value.length <= 240);
      const definitions = [...new Map(english.map((value) => [value.toLowerCase(), value])).values()].slice(0, 2);
      if (!definitions.length) continue;
      const wanted = targets.get(word);
      const candidate = {
        word, level: wanted.level, pos: posKey(entry.pos), meaning,
        definition: definitions[0], definitions,
        confidence: entry.extra?.llm_confidence || "unknown",
        frequency: Number(entry.freq) || 0,
        tier: Number(entry.freq_tier) || 9,
      };
      const current = matches.get(word);
      const score = (candidate.pos === wanted.pos ? 100 : 0) + (candidate.confidence === "high" ? 20 : candidate.confidence === "medium" ? 10 : 0) - candidate.tier + candidate.frequency / 100;
      if (!current || score > current.score) matches.set(word, { ...candidate, score });
    }
    if (cursor % 12 === 0) console.log(`Dictionary shards: ${cursor}/${shards.length}`);
  }
}));
const cards = [...matches.values()]
  .filter((card) => ["high", "medium"].includes(card.confidence))
  .map(({ score, ...card }) => card)
  .sort((a, b) => levels.indexOf(a.level) - levels.indexOf(b.level) || a.word.localeCompare(b.word));
const counts = Object.fromEntries(levels.map((level) => [level, cards.filter((card) => card.level === level).length]));
if (levels.some((level) => counts[level] < 100)) throw new Error(`Too few translated words for a level: ${JSON.stringify(counts)}`);
await writeFile(destination, JSON.stringify({ generatedAt: new Date().toISOString(), counts, sources: [
  { name: "CEFR-J Vocabulary Profile 1.5 and Octanove C1/C2", url: `https://github.com/${cefrRepo}`, revision: cefrSha },
  { name: "thichhoc-dict Anh–Việt", url: `https://github.com/${dictRepo}`, revision: dictSha, license: "CC BY-SA 4.0" },
], cards }) + "\n", "utf8");
console.log(`Wrote ${cards.length} cards: ${JSON.stringify(counts)}`);
