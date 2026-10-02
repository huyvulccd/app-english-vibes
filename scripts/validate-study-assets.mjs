import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "lesson-data", "catalog.json"), "utf8"));
const audio = JSON.parse(await readFile(path.join(root, "lesson-audio.json"), "utf8"));
const sources = JSON.parse(await readFile(path.join(root, "lesson-audio-sources.json"), "utf8"));
const slugs = ["beginner", "elementary", "pre-intermediate", "intermediate", "upper-intermediate", "advanced"];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const size = async (file) => (await stat(file)).size;

assert(catalog.levels.length === 6, "Expected six course levels");
assert(catalog.books.length === 203, "Expected all 203 PDFs in the catalog");
assert(new Set(catalog.books.map((book) => book.id)).size === catalog.books.length, "Duplicate book identifiers");
const count = { pages: 0, images: 0, imageBytes: 0, ocr: 0, activities: 0 };
for (const book of catalog.books) {
  const data = JSON.parse(await readFile(path.join(root, "lesson-data", `${book.id}.json`), "utf8"));
  assert(data.pages.length === book.pages, `Page count differs in ${book.id}`);
  assert(book.startPage >= 1 && book.startPage <= book.pages, `Invalid start page for ${book.id}`);
  for (const [index, page] of data.pages.entries()) {
    assert(page.number === index + 1, `Page order differs in ${book.id}`);
    assert(Array.isArray(page.activities) && Array.isArray(page.tracks), `Incomplete page metadata in ${book.id}`);
    const file = path.resolve(root, page.image.replace(/^\.\//, ""));
    assert(file.startsWith(`${root}${path.sep}`), `Invalid image path in ${book.id}`);
    const bytes = await size(file);
    assert(bytes > 1000, `Empty page image: ${file}`);
    count.images++;
    count.imageBytes += bytes;
    count.ocr += Number(page.ocr);
    count.activities += page.activities.length;
  }
  count.pages += data.pages.length;
}
assert(count.pages === 3370 && count.images === count.pages, "Expected all 3,370 converted pages");
assert(count.imageBytes < 950_000_000, "Lesson images exceed the planned GitHub Pages size");
assert(audio.files.length === 5206, "Expected all 5,206 audio tracks");
assert(new Set(audio.files.map((item) => item.id)).size === audio.files.length, "Duplicate audio identifiers");

const audioBytes = Object.fromEntries(catalog.levels.map(([level]) => [level, 0]));
for (const item of audio.files) {
  const levelIndex = catalog.levels.findIndex(([level]) => level === item.level);
  assert(levelIndex >= 0, `Invalid audio level: ${item.level}`);
  const file = path.join(root, "SOURCE", "audio-sites", `app-english-vibes-audio-${slugs[levelIndex]}`, "audio", `${item.id}.mp3`);
  const bytes = await size(file);
  assert(bytes > 100 && bytes < 100_000_000, `Invalid audio file: ${file}`);
  audioBytes[item.level] += bytes;
  if (process.argv.includes("--published")) {
    assert(sources.levels[item.level] === `https://huyvulccd.github.io/app-english-vibes-audio-${slugs[levelIndex]}`, `Audio source URL missing for ${item.level}`);
  }
}
for (const [level, bytes] of Object.entries(audioBytes)) assert(bytes < 950_000_000, `Audio site exceeds planned size: ${level}`);
console.log(JSON.stringify({ books: catalog.books.length, pages: count.pages, imageMiB: +(count.imageBytes / 1048576).toFixed(1), ocrPages: count.ocr, activityPrompts: count.activities, audioTracks: audio.files.length, audioMiB: Object.fromEntries(Object.entries(audioBytes).map(([level, bytes]) => [level, +(bytes / 1048576).toFixed(1)])) }, null, 2));
