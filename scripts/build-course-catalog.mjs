import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "SOURCE", "extracted", "New-english-file");
const output = path.join(projectRoot, "course-catalog.json");
const expectedLevels = [
  "1.BEGINNER",
  "2.ELEMENTARY",
  "3.PRE-INTERMEDIATE",
  "4.INTERMEDIATE",
  "5.UPPER-INTERMEDIATE",
  "6.ADVANCED",
];

const files = [];
async function visit(directory, parts) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const nextParts = [...parts, entry.name];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath, nextParts);
    } else if (entry.isFile()) {
      files.push([nextParts.join("/"), (await stat(fullPath)).size]);
    }
  }
}

for (const level of expectedLevels) {
  await visit(path.join(sourceRoot, level), [level]);
}

const catalog = {
  title: "New English File",
  levels: expectedLevels,
  files,
};
await writeFile(output, `${JSON.stringify(catalog)}\n`, "utf8");
const bytes = files.reduce((sum, entry) => sum + entry[1], 0);
console.log(`Wrote ${files.length} files (${bytes} bytes) to ${output}`);
