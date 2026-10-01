import { describeCourseFile, formatBytes, matchesCourseSearch } from "./course-model.mjs";

const PROGRESS_KEY = "sayback-course-progress-v1";
const LAST_KEY = "sayback-course-last-v1";
const LEVEL_KEY = "sayback-course-level-v1";
const TOPIC_KEY = "sayback-course-topic-v1";
const PAGE_SIZE = 80;
const TOPICS = [
  ["all", "Tất cả"],
  ["books", "Sách & tài liệu"],
  ["listening", "Nghe"],
  ["pronunciation", "Phát âm"],
  ["vocabulary", "Từ vựng"],
  ["grammar", "Ngữ pháp"],
  ["communication", "Giao tiếp"],
  ["dictation", "Chính tả"],
  ["tests", "Kiểm tra"],
  ["legacy", "CD-ROM & tệp khác"],
];
const LEVEL_NAMES = {
  "1.BEGINNER": "Beginner",
  "2.ELEMENTARY": "Elementary",
  "3.PRE-INTERMEDIATE": "Pre-Intermediate",
  "4.INTERMEDIATE": "Intermediate",
  "5.UPPER-INTERMEDIATE": "Upper-Intermediate",
  "6.ADVANCED": "Advanced",
};
const $ = (selector) => document.querySelector(selector);
const ui = {
  chooseFolder: $("#choose-folder"),
  folderFallback: $("#folder-fallback"),
  reconnectButton: $("#reconnect-button"),
  sourceStatus: $("#source-status"),
  sourceMessage: $("#source-message"),
  totalFiles: $("#total-files"),
  completedTotal: $("#completed-total"),
  continueButton: $("#continue-button"),
  levelList: $("#level-list"),
  packLink: $("#pack-link"),
  currentLevelTitle: $("#current-level-title"),
  search: $("#course-search"),
  topicTabs: $("#topic-tabs"),
  listSummary: $("#list-summary"),
  fileList: $("#file-list"),
  loadMore: $("#load-more"),
  viewerEmpty: $("#viewer-empty"),
  viewerContent: $("#viewer-content"),
  viewerKind: $("#viewer-kind"),
  viewerTitle: $("#viewer-title"),
  viewerPath: $("#viewer-path"),
  assetMessage: $("#asset-message"),
  pdfWrap: $("#pdf-wrap"),
  pdfViewer: $("#pdf-viewer"),
  audioWrap: $("#audio-wrap"),
  audio: $("#course-audio"),
  speed: $("#playback-speed"),
  repeat: $("#repeat-audio"),
  markComplete: $("#mark-complete"),
  download: $("#download-asset"),
};

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const savedProgress = readStorage(PROGRESS_KEY, []);
const state = {
  levels: [],
  entries: [],
  sources: { levels: {}, packs: {}, excludedExtensions: [] },
  level: localStorage.getItem(LEVEL_KEY) || "1.BEGINNER",
  topic: localStorage.getItem(TOPIC_KEY) || "all",
  query: "",
  limit: PAGE_SIZE,
  selectedPath: null,
  lastPath: localStorage.getItem(LAST_KEY) || "",
  progress: new Set(Array.isArray(savedProgress) ? savedProgress : []),
  directoryHandle: null,
  fallbackFiles: new Map(),
  objectUrl: null,
  viewToken: 0,
};

function filteredEntries() {
  return state.entries.filter((entry) =>
    (state.level === "all" || entry.level === state.level) &&
    (state.topic === "all" || entry.topic === state.topic) &&
    matchesCourseSearch(entry, state.query));
}

function createElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function renderLevels() {
  ui.levelList.replaceChildren();
  const options = [["all", "Tất cả cấp độ"], ...state.levels.map((level) => [level, LEVEL_NAMES[level] || level])];
  for (const [key, label] of options) {
    const count = state.entries.filter((entry) => key === "all" || entry.level === key).length;
    const done = state.entries.filter((entry) => (key === "all" || entry.level === key) && state.progress.has(entry.path)).length;
    const button = createElement("button", `level-button${state.level === key ? " active" : ""}`);
    button.type = "button";
    button.dataset.level = key;
    button.setAttribute("aria-pressed", String(state.level === key));
    button.append(
      createElement("span", "level-number", key === "all" ? "◎" : key.split(".")[0].padStart(2, "0")),
      createElement("span", "level-copy"),
      createElement("span", "level-done", done ? `${done} ✓` : ""),
    );
    button.querySelector(".level-copy").append(
      createElement("strong", "", label),
      createElement("small", "", `${count.toLocaleString("vi-VN")} tệp`),
    );
    ui.levelList.append(button);
  }
  ui.currentLevelTitle.textContent = state.level === "all" ? "Tất cả cấp độ" : LEVEL_NAMES[state.level] || state.level;
  const pack = state.sources.packs[state.level];
  ui.packLink.hidden = !(typeof pack === "string" && /^https:\/\//.test(pack));
  if (!ui.packLink.hidden) {
    ui.packLink.href = pack;
    ui.packLink.textContent = `Tải trọn bộ ${LEVEL_NAMES[state.level]} ↗`;
  }
}

function renderTopics() {
  ui.topicTabs.replaceChildren();
  const entries = state.entries.filter((entry) => state.level === "all" || entry.level === state.level);
  for (const [key, label] of TOPICS) {
    const count = key === "all" ? entries.length : entries.filter((entry) => entry.topic === key).length;
    const button = createElement("button", `topic-tab${state.topic === key ? " active" : ""}`);
    button.type = "button";
    button.dataset.topic = key;
    button.setAttribute("aria-pressed", String(state.topic === key));
    button.append(document.createTextNode(label), createElement("small", "", String(count)));
    ui.topicTabs.append(button);
  }
}

function fileKindLabel(entry) {
  if (entry.kind === "pdf") return "PDF";
  if (entry.kind === "audio") return "Âm thanh";
  if (entry.kind === "document") return "Tài liệu";
  return entry.extension ? entry.extension.toUpperCase() : "Tệp";
}

function renderFiles() {
  const entries = filteredEntries();
  ui.fileList.replaceChildren();
  ui.listSummary.textContent = `${entries.length.toLocaleString("vi-VN")} mục · Hiển thị ${Math.min(entries.length, state.limit).toLocaleString("vi-VN")} mục`;
  ui.loadMore.hidden = entries.length <= state.limit;
  if (!entries.length) {
    ui.fileList.append(createElement("p", "empty-results", "Không tìm thấy tệp phù hợp. Hãy thử từ khóa hoặc phần học khác."));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries.slice(0, state.limit)) {
    const button = createElement("button", `file-row${entry.path === state.selectedPath ? " active" : ""}`);
    button.type = "button";
    button.dataset.path = entry.path;
    button.setAttribute("aria-current", String(entry.path === state.selectedPath));
    const icon = createElement("span", `file-icon ${entry.kind}`, entry.kind === "audio" ? "♫" : entry.kind === "pdf" ? "PDF" : entry.kind === "legacy" ? "FILE" : "DOC");
    const copy = createElement("span", "file-copy");
    copy.append(createElement("strong", "", entry.name), createElement("small", "", `${entry.path.slice(entry.level.length + 1, -entry.name.length).replace(/\/$/, "")} · ${formatBytes(entry.bytes)}`));
    button.append(icon, copy, createElement("span", "file-check", state.progress.has(entry.path) ? "✓" : ""));
    fragment.append(button);
  }
  ui.fileList.append(fragment);
}

function renderProgress() {
  ui.totalFiles.textContent = state.entries.length.toLocaleString("vi-VN");
  ui.completedTotal.textContent = state.progress.size.toLocaleString("vi-VN");
  ui.continueButton.hidden = !state.lastPath || !state.entries.some((entry) => entry.path === state.lastPath);
  const selected = state.entries.find((entry) => entry.path === state.selectedPath);
  if (selected) ui.markComplete.textContent = state.progress.has(selected.path) ? "✓ Đã học · Bỏ đánh dấu" : "Đánh dấu đã học";
}

function render() {
  renderLevels();
  renderTopics();
  renderFiles();
  renderProgress();
}

function updateSourceStatus(message) {
  const hasRemote = Object.keys(state.sources.levels).length > 0;
  const hasLocal = Boolean(state.directoryHandle || state.fallbackFiles.size);
  const ready = hasLocal || hasRemote;
  ui.sourceStatus.dataset.state = ready ? "ready" : "missing";
  ui.sourceMessage.textContent = message || (hasLocal ? "Đã kết nối thư mục học liệu trên máy." : hasRemote ? "Học liệu trực tuyến đã sẵn sàng." : "Danh mục đã sẵn sàng. Chọn thư mục New-english-file đã giải nén để mở sách và audio.");
  ui.reconnectButton.hidden = !state.directoryHandle;
}

function releaseObjectUrl() {
  ui.audio.pause();
  ui.audio.removeAttribute("src");
  ui.pdfViewer.removeAttribute("src");
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
}

async function getFileFromHandle(relativePath) {
  if (!state.directoryHandle) return null;
  let current = state.directoryHandle;
  const parts = relativePath.split("/");
  for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part);
  return (await current.getFileHandle(parts.at(-1))).getFile();
}

async function resolveAsset(entry) {
  const localFile = state.fallbackFiles.get(entry.path) || await getFileFromHandle(entry.path).catch(() => null);
  if (localFile) {
    const url = URL.createObjectURL(localFile);
    return { url, local: true };
  }
  if (state.sources.excludedExtensions.includes(entry.extension)) return null;
  const base = state.sources.levels[entry.level];
  if (typeof base === "string" && /^https:\/\//.test(base)) {
    const path = entry.path.split("/").slice(1).map(encodeURIComponent).join("/");
    return { url: `${base.replace(/\/$/, "")}/${path}`, local: false };
  }
  return null;
}

function showMissingAsset(entry) {
  ui.assetMessage.hidden = false;
  ui.assetMessage.replaceChildren(document.createTextNode("Chọn thư mục New-english-file đã giải nén để mở tệp này trên máy. "));
  const pack = state.sources.packs[entry.level];
  if (typeof pack === "string" && /^https:\/\//.test(pack)) {
    const link = createElement("a", "", `Tải trọn bộ ${LEVEL_NAMES[entry.level] || entry.level} ↗`);
    link.href = pack;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    ui.assetMessage.append(link);
  }
  ui.pdfWrap.hidden = true;
  ui.audioWrap.hidden = true;
  ui.download.hidden = true;
}

async function selectEntry(path) {
  const entry = state.entries.find((item) => item.path === path);
  if (!entry) return;
  state.selectedPath = path;
  state.lastPath = path;
  localStorage.setItem(LAST_KEY, path);
  renderFiles();
  renderProgress();
  ui.viewerEmpty.hidden = true;
  ui.viewerContent.hidden = false;
  ui.viewerKind.textContent = `${TOPICS.find(([key]) => key === entry.topic)?.[1] || "Tài liệu"} · ${fileKindLabel(entry)} · ${formatBytes(entry.bytes)}`;
  ui.viewerTitle.textContent = entry.name;
  ui.viewerPath.textContent = entry.path;
  ui.assetMessage.hidden = true;
  ui.pdfWrap.hidden = true;
  ui.audioWrap.hidden = true;
  ui.download.hidden = true;
  releaseObjectUrl();
  const token = ++state.viewToken;
  const asset = await resolveAsset(entry);
  if (token !== state.viewToken) {
    if (asset?.local) URL.revokeObjectURL(asset.url);
    return;
  }
  if (!asset) {
    showMissingAsset(entry);
    return;
  }
  if (asset.local) state.objectUrl = asset.url;
  ui.download.href = asset.url;
  ui.download.download = entry.name;
  ui.download.hidden = false;
  if (entry.kind === "pdf") {
    ui.pdfViewer.src = `${asset.url}#view=FitH`;
    ui.pdfWrap.hidden = false;
  } else if (entry.kind === "audio") {
    ui.audio.src = asset.url;
    ui.audio.playbackRate = Number(ui.speed.value);
    ui.audio.loop = ui.repeat.checked;
    ui.audioWrap.hidden = false;
  } else {
    ui.assetMessage.hidden = false;
    ui.assetMessage.textContent = "Tệp này thuộc bộ CD-ROM cũ hoặc tài liệu bổ trợ. Bạn có thể tải về để mở bằng ứng dụng phù hợp.";
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sayback-course-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putHandle(handle) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      transaction.objectStore("settings").put(handle, "courseRoot");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function savedHandle() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("settings", "readonly").objectStore("settings").get("courseRoot");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function findCourseRoot(handle) {
  if (handle.name === "New-english-file") return handle;
  try { return await handle.getDirectoryHandle("New-english-file"); } catch { /* try nested */ }
  try {
    const extracted = await handle.getDirectoryHandle("extracted");
    return await extracted.getDirectoryHandle("New-english-file");
  } catch { throw new Error("Hãy chọn thư mục New-english-file trong SOURCE/extracted."); }
}

async function chooseDirectory() {
  if (!window.showDirectoryPicker) {
    ui.folderFallback.click();
    return;
  }
  try {
    const handle = await findCourseRoot(await window.showDirectoryPicker({ mode: "read" }));
    state.directoryHandle = handle;
    state.fallbackFiles.clear();
    await putHandle(handle).catch(() => {});
    updateSourceStatus();
    if (state.selectedPath) await selectEntry(state.selectedPath);
  } catch (error) {
    if (error?.name !== "AbortError") updateSourceStatus(error?.message || "Không mở được thư mục học liệu.");
  }
}

async function reconnectDirectory() {
  if (!state.directoryHandle) return chooseDirectory();
  try {
    const result = await state.directoryHandle.requestPermission({ mode: "read" });
    if (result === "granted") {
      updateSourceStatus();
      if (state.selectedPath) await selectEntry(state.selectedPath);
    } else updateSourceStatus("Cần cấp quyền đọc lại thư mục để mở học liệu.");
  } catch { updateSourceStatus("Hãy chọn lại thư mục học liệu."); }
}

function handleFallbackFiles(fileList) {
  state.fallbackFiles.clear();
  const levelNames = new Set(state.levels);
  for (const file of fileList) {
    const parts = file.webkitRelativePath.split("/");
    const start = parts.findIndex((part) => levelNames.has(part));
    if (start >= 0) state.fallbackFiles.set(parts.slice(start).join("/"), file);
  }
  if (!state.fallbackFiles.size) {
    updateSourceStatus("Thư mục này không chứa học liệu New-english-file. Hãy chọn lại.");
    return;
  }
  state.directoryHandle = null;
  updateSourceStatus(`Đã kết nối ${state.fallbackFiles.size.toLocaleString("vi-VN")} tệp trên máy. Chọn lại thư mục sau khi tải lại trang.`);
  if (state.selectedPath) selectEntry(state.selectedPath);
}

ui.chooseFolder.addEventListener("click", chooseDirectory);
ui.reconnectButton.addEventListener("click", reconnectDirectory);
ui.folderFallback.addEventListener("change", (event) => handleFallbackFiles(event.target.files));
ui.continueButton.addEventListener("click", () => {
  const entry = state.entries.find((item) => item.path === state.lastPath);
  if (!entry) return;
  state.level = entry.level;
  state.topic = "all";
  state.query = "";
  ui.search.value = "";
  state.limit = PAGE_SIZE;
  render();
  selectEntry(entry.path);
  $(".study-main").scrollIntoView({ behavior: "smooth", block: "start" });
});
ui.levelList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-level]");
  if (!button) return;
  state.level = button.dataset.level;
  state.limit = PAGE_SIZE;
  localStorage.setItem(LEVEL_KEY, state.level);
  render();
});
ui.topicTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  state.topic = button.dataset.topic;
  state.limit = PAGE_SIZE;
  localStorage.setItem(TOPIC_KEY, state.topic);
  renderTopics();
  renderFiles();
});
ui.search.addEventListener("input", () => {
  state.query = ui.search.value;
  state.limit = PAGE_SIZE;
  renderFiles();
});
ui.fileList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-path]");
  if (button) selectEntry(button.dataset.path);
});
ui.loadMore.addEventListener("click", () => {
  state.limit += PAGE_SIZE;
  renderFiles();
});
ui.markComplete.addEventListener("click", () => {
  if (!state.selectedPath) return;
  if (state.progress.has(state.selectedPath)) state.progress.delete(state.selectedPath);
  else state.progress.add(state.selectedPath);
  localStorage.setItem(PROGRESS_KEY, JSON.stringify([...state.progress]));
  render();
});
ui.speed.addEventListener("change", () => { ui.audio.playbackRate = Number(ui.speed.value); });
ui.repeat.addEventListener("change", () => { ui.audio.loop = ui.repeat.checked; });
window.addEventListener("beforeunload", releaseObjectUrl);

async function init() {
  try {
    const [catalogResponse, sourcesResponse] = await Promise.all([
      fetch("./course-catalog.json"),
      fetch("./course-sources.json"),
    ]);
    if (!catalogResponse.ok) throw new Error("Không tải được danh mục học liệu.");
    const catalog = await catalogResponse.json();
    state.levels = Array.isArray(catalog.levels) ? catalog.levels : [];
    state.entries = Array.isArray(catalog.files)
      ? catalog.files.filter((item) => Array.isArray(item) && typeof item[0] === "string" && Number.isFinite(item[1])).map(([path, bytes]) => describeCourseFile(path, bytes))
      : [];
    if (sourcesResponse.ok) {
      const sources = await sourcesResponse.json();
      state.sources.levels = sources.levels || {};
      state.sources.packs = sources.packs || {};
      state.sources.excludedExtensions = Array.isArray(sources.excludedExtensions) ? sources.excludedExtensions : [];
    }
    if (!state.levels.includes(state.level) && state.level !== "all") state.level = state.levels[0] || "all";
    if (!TOPICS.some(([topic]) => topic === state.topic)) state.topic = "all";
    render();
    updateSourceStatus();
    const handle = await savedHandle().catch(() => null);
    if (handle) {
      state.directoryHandle = handle;
      const permission = await handle.queryPermission({ mode: "read" }).catch(() => "prompt");
      updateSourceStatus(permission === "granted" ? "Đã kết nối lại thư mục học liệu trên máy." : "Nhấn Kết nối lại để cấp quyền đọc thư mục học liệu.");
      if (permission !== "granted" && !Object.keys(state.sources.levels).length) ui.sourceStatus.dataset.state = "missing";
    }
    if (state.lastPath && state.entries.some((entry) => entry.path === state.lastPath)) selectEntry(state.lastPath);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (error) {
    ui.sourceStatus.dataset.state = "missing";
    ui.sourceMessage.textContent = error.message || "Không tải được danh mục học liệu.";
    ui.currentLevelTitle.textContent = "Danh mục chưa sẵn sàng";
  }
}
init();
