import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const catalog = JSON.parse(await readFile(path.join(root, "lesson-data", "catalog.json"), "utf8"));
if (!catalog.books.length) throw new Error("No lesson books were generated");
const firstBook = catalog.books.find((book) => book.level === "1.BEGINNER" && book.role === "student") || catalog.books[0];
const nextPage = firstBook.startPage + 1;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    const content = await readFile(target);
    response.writeHead(200, { "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "sayback-study-chrome-"));
const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const errors = [];
let socket;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(callback, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await callback();
    if (value) return value;
    await delay(100);
  }
  throw new Error("Timed out waiting for the study page");
}

try {
  const port = await waitUntil(async () => {
    try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; }
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `${origin}/study.html` });
  await waitUntil(() => evaluate("document.querySelector('#lesson-content')?.hidden === false && document.querySelector('#page-image')?.complete && document.querySelector('#page-image')?.naturalWidth > 0"));
  const initial = await evaluate("({ levels: document.querySelectorAll('.level-button').length, books: document.querySelectorAll('.book-button').length, imageWidth: document.querySelector('#page-image').naturalWidth, page: document.querySelector('#page-number').value })");
  if (initial.levels !== 6 || !initial.books || initial.imageWidth < 800) throw new Error(`Invalid lesson render: ${JSON.stringify(initial)}`);

  await evaluate("document.querySelector('#next-page').click()");
  await waitUntil(() => evaluate(`document.querySelector('#page-number')?.value === '${nextPage}' && document.querySelector('#page-image')?.complete && document.querySelector('#page-image')?.naturalWidth > 0`));
  await evaluate("document.querySelector('#mark-page').click()");
  await evaluate("document.querySelector('[data-tab=write]').click()");
  await evaluate("(() => { const note = document.querySelector('#page-notes'); note.value = 'My lesson note'; note.dispatchEvent(new Event('input', { bubbles: true })); const answer = document.querySelector('[data-answer]'); if (answer) { answer.value = 'My answer'; answer.dispatchEvent(new Event('input', { bubbles: true })); } })()");
  await delay(500);
  const saved = await evaluate("({ progress: JSON.parse(localStorage.getItem('sayback-study-pages-v1')), notes: JSON.parse(localStorage.getItem('sayback-study-notes-v1')), answers: JSON.parse(localStorage.getItem('sayback-study-answers-v1')) })");
  if (!saved.progress.length || !Object.values(saved.notes).includes("My lesson note")) throw new Error("Lesson progress or notes were not saved");

  await send("Page.reload", { ignoreCache: true });
  await waitUntil(() => evaluate("document.querySelector('#lesson-content')?.hidden === false && document.querySelector('#page-image')?.complete"));
  const restored = await evaluate("({ page: document.querySelector('#page-number').value, note: document.querySelector('#page-notes').value, marked: document.querySelector('#mark-page').textContent, image: document.querySelector('#page-image').naturalWidth })");
  if (restored.page !== String(nextPage) || restored.note !== "My lesson note" || !restored.marked.includes("Đã học") || !restored.image) throw new Error(`State was not restored: ${JSON.stringify(restored)}`);

  if (process.env.STUDY_SCREENSHOTS === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.reload", { ignoreCache: true });
    await waitUntil(() => evaluate("document.querySelector('#lesson-content')?.hidden === false && document.querySelector('#page-image')?.naturalWidth > 0"));
    const desktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".study-desktop.png"), Buffer.from(desktop.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobile = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".study-mobile.png"), Buffer.from(mobile.data, "base64"));
  }
  const openedLevels = [];
  for (const [level] of catalog.levels.slice(1)) {
    const student = catalog.books.find((book) => book.level === level && book.role === "student");
    await evaluate(`document.querySelector('[data-level="${level}"]').click()`);
    await waitUntil(() => evaluate(`document.querySelector('#lesson-title')?.textContent === ${JSON.stringify(student.title)} && document.querySelector('#page-image')?.naturalWidth > 0`));
    openedLevels.push(level);
  }
  await send("Page.navigate", { url: `${origin}/index.html?practice=Hello%20from%20a%20lesson` });
  try {
    await waitUntil(() => evaluate("JSON.parse(localStorage.getItem('sayback-items-v1') || '[]').some((item) => item.text === 'Hello from a lesson')"));
  } catch (error) {
    const detail = await evaluate("({ href: location.href, items: localStorage.getItem('sayback-items-v1'), scripts: [...document.scripts].map((item) => item.src), readyState: document.readyState })").catch(() => null);
    throw new Error(`${error.message}: ${JSON.stringify({ detail, errors })}`);
  }
  if (await evaluate("location.search !== ''")) throw new Error("Practice query was not cleared after import");
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ initial, restored, savedAnswers: Object.keys(saved.answers || {}).length, openedLevels, practiceImport: true, browserErrors: errors.length }, null, 2));
} finally {
  socket?.close();
  browser.kill();
  await delay(500);
  const safeRoot = path.resolve(os.tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(safeRoot) && path.basename(profile).startsWith("sayback-study-chrome-")) await rm(profile, { recursive: true, force: true }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
