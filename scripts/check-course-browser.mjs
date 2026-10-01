import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const catalog = JSON.parse(await readFile(path.join(root, "course-catalog.json"), "utf8"));
const pdf = catalog.files.filter(([name]) => name.toLowerCase().endsWith(".pdf")).sort((a, b) => a[1] - b[1])[0];
const audio = catalog.files.filter(([name]) => name.toLowerCase().endsWith(".mp3")).sort((a, b) => a[1] - b[1])[0];
if (!pdf || !audio) throw new Error("Missing PDF or MP3 in catalog");

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    const content = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    const contentType = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".pdf": "application/pdf", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "sayback-course-chrome-"));
const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const errors = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(callback, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await callback();
    if (result) return result;
    await delay(100);
  }
  throw new Error("Timed out waiting for browser state");
}

async function connect() {
  const activePort = await waitUntil(async () => {
    try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; }
  });
  const pages = await (await fetch(`http://127.0.0.1:${activePort}/json/list`)).json();
  const page = pages.find((item) => item.type === "page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate };
}

try {
  const { send, evaluate } = await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.navigate", { url: `${origin}/course.html` });
  await waitUntil(() => evaluate("document.querySelector('#total-files')?.textContent === '5.881'"));
  const initial = await evaluate("({ count: document.querySelector('#total-files').textContent, levels: document.querySelectorAll('.level-button').length, topics: document.querySelectorAll('.topic-tab').length })");
  if (initial.count !== "5.881" || initial.levels !== 7 || initial.topics !== 10) throw new Error(`Catalog mismatch: ${JSON.stringify(initial)}`);

  const selectedPaths = [pdf[0], audio[0]];
  const injected = await evaluate(`(async () => {
    const specs = ${JSON.stringify(selectedPaths)};
    const files = [];
    for (const item of specs) {
      const response = await fetch('/SOURCE/extracted/New-english-file/' + item.split('/').map(encodeURIComponent).join('/'));
      const blob = await response.blob();
      const file = new File([blob], item.split('/').at(-1), { type: blob.type });
      Object.defineProperty(file, 'webkitRelativePath', { value: 'New-english-file/' + item });
      files.push(file);
    }
    const input = document.querySelector('#folder-fallback');
    Object.defineProperty(input, 'files', { configurable: true, get: () => files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#source-message').textContent;
  })()`);
  if (!injected.includes("2 tệp")) throw new Error(`Local folder import failed: ${injected}`);

  async function openPath(relativePath) {
    await evaluate(`(() => {
      document.querySelector('[data-level="all"]').click();
      const input = document.querySelector('#course-search');
      input.value = ${JSON.stringify(relativePath.split("/").at(-1))};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const row = [...document.querySelectorAll('.file-row')].find((node) => node.dataset.path === ${JSON.stringify(relativePath)});
      if (!row) throw new Error('Missing row for selected file');
      row.click();
    })()`);
  }
  await openPath(pdf[0]);
  await waitUntil(() => evaluate("document.querySelector('#pdf-viewer').src.startsWith('blob:')"));
  await openPath(audio[0]);
  await waitUntil(() => evaluate("document.querySelector('#course-audio').src.startsWith('blob:')"));
  await evaluate("document.querySelector('#mark-complete').click()");
  const saved = await evaluate("JSON.parse(localStorage.getItem('sayback-course-progress-v1'))");
  if (!saved.includes(audio[0])) throw new Error("Progress was not saved");

  await waitUntil(() => evaluate("Boolean(navigator.serviceWorker.controller)"), 20000);
  await send("Page.reload", { ignoreCache: true });
  await waitUntil(() => evaluate("document.querySelector('#total-files')?.textContent === '5.881'"));
  const afterReload = await evaluate("({ done: document.querySelector('#completed-total').textContent, last: localStorage.getItem('sayback-course-last-v1') })");
  if (afterReload.done !== "1" || afterReload.last !== audio[0]) throw new Error(`Reload lost progress: ${JSON.stringify(afterReload)}`);

  if (process.env.COURSE_SCREENSHOTS === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const desktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".course-desktop.png"), Buffer.from(desktop.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobile = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".course-mobile.png"), Buffer.from(mobile.data, "base64"));
  }

  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send("Page.reload", { ignoreCache: true });
  await waitUntil(() => evaluate("document.querySelector('#total-files')?.textContent === '5.881'"));
  const offline = await evaluate("({ count: document.querySelector('#total-files').textContent, done: document.querySelector('#completed-total').textContent })");
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ initial, injected, pdf: pdf[0], audio: audio[0], afterReload, offline, browserErrors: errors.length }, null, 2));
} finally {
  if (socket) socket.close();
  browser.kill();
  await delay(500);
  if (profile.startsWith(path.join(os.tmpdir(), "sayback-course-chrome-"))) await rm(profile, { recursive: true, force: true }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
