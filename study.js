const CATALOG_URL = "./lesson-data/catalog.json";
const AUDIO_URL = "./lesson-audio.json";
const AUDIO_SOURCES_URL = "./lesson-audio-sources.json";
const PROGRESS_KEY = "sayback-study-pages-v1";
const NOTES_KEY = "sayback-study-notes-v1";
const ANSWERS_KEY = "sayback-study-answers-v1";
const LAST_KEY = "sayback-study-last-v1";
const LEVEL_KEY = "sayback-study-level-v1";
const ROLE_KEY = "sayback-study-role-v1";
const ROLES = [
  ["student", "Sách học"],
  ["workbook", "Workbook"],
  ["test", "Kiểm tra"],
  ["grammar", "Ngữ pháp"],
  ["teacher", "Giáo viên"],
  ["resource", "Bổ trợ"],
  ["all", "Tất cả"],
];
const TOPIC_NAMES = {
  grammar: "Ngữ pháp", vocabulary: "Từ vựng", pronunciation: "Phát âm",
  listening: "Nghe", reading: "Đọc", speaking: "Nói", writing: "Viết", practical: "Giao tiếp",
};
const $ = (selector) => document.querySelector(selector);
const ui = {
  levels: $("#levels"), roles: $("#roles"), books: $("#books"), bookCount: $("#book-count"), bookSearch: $("#book-search"),
  loadStatus: $("#load-status"), content: $("#lesson-content"), eyebrow: $("#lesson-eyebrow"), title: $("#lesson-title"), subtitle: $("#lesson-subtitle"), completedCount: $("#completed-count"),
  previous: $("#previous-page"), next: $("#next-page"), pageNumber: $("#page-number"), pageTotal: $("#page-total"), markPage: $("#mark-page"), togglePages: $("#toggle-pages"), pageGrid: $("#page-grid"), pageImage: $("#page-image"), pageCaption: $("#page-caption"), pageTopics: $("#page-topics"),
  tabs: $(".tool-tabs"), listenPanel: $("#listen-panel"), readPanel: $("#read-panel"), writePanel: $("#write-panel"),
  suggestedAudio: $("#suggested-audio"), audioSearch: $("#audio-search"), audioList: $("#audio-list"), moreAudio: $("#more-audio"), audioTitle: $("#audio-title"), audioPath: $("#audio-path"), audio: $("#lesson-audio"), audioSpeed: $("#audio-speed"), audioRepeat: $("#audio-repeat"),
  recordButton: $("#record-button"), recordStatus: $("#record-status"), recordingPlayback: $("#recording-playback"),
  pageText: $("#page-text"), textSearch: $("#text-search"), textSearchResults: $("#text-search-results"), practiceSelection: $("#practice-selection"), speakSelection: $("#speak-selection"),
  notes: $("#page-notes"), notesStatus: $("#notes-status"), activityList: $("#activity-list"), onlineStatus: $("#online-status"), zoomOverlay: $("#zoom-overlay"), zoomImage: $("#zoom-image"), closeZoom: $("#close-zoom"),
};

function readJsonStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const savedProgress = readJsonStorage(PROGRESS_KEY, []);
const state = {
  levels: [], books: [], audio: [], audioSources: {},
  level: localStorage.getItem(LEVEL_KEY) || "1.BEGINNER",
  role: localStorage.getItem(ROLE_KEY) || "student",
  search: "", audioSearch: "", audioLimit: 24,
  book: null, bookData: null, page: 1, tab: "listen", bookToken: 0,
  progress: new Set(Array.isArray(savedProgress) ? savedProgress : []),
  notes: readJsonStorage(NOTES_KEY, {}),
  answers: readJsonStorage(ANSWERS_KEY, {}),
  last: readJsonStorage(LAST_KEY, null),
  selectedAudioId: null,
  recorder: null, stream: null, chunks: [], recordingUrl: null,
  noteTimer: null,
};

function element(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = value;
  return item;
}
function levelName(code) { return state.levels.find(([key]) => key === code)?.[1] || code; }
function pageKey(book, page) { return `${book.id}:${page}`; }
function currentPage() { return state.bookData?.pages[state.page - 1]; }
function saveStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function renderLevels() {
  ui.levels.replaceChildren();
  for (const [key, name] of state.levels) {
    const count = state.books.filter((book) => book.level === key && book.role === "student").length;
    const button = element("button", `level-button${state.level === key ? " active" : ""}`);
    button.type = "button";
    button.dataset.level = key;
    button.setAttribute("aria-pressed", String(state.level === key));
    const copy = element("span");
    copy.append(element("strong", "", name), element("small", "", count ? "Sách học & bài luyện tập" : "Tài liệu học"));
    button.append(element("span", "level-number", key.split(".")[0].padStart(2, "0")), copy);
    ui.levels.append(button);
  }
}

function renderRoles() {
  ui.roles.replaceChildren();
  const books = state.books.filter((book) => book.level === state.level);
  for (const [key, label] of ROLES) {
    const count = key === "all" ? books.length : books.filter((book) => book.role === key).length;
    if (!count && key !== "all") continue;
    const button = element("button", `role-tab${state.role === key ? " active" : ""}`, `${label} ${count}`);
    button.type = "button";
    button.dataset.role = key;
    button.setAttribute("aria-pressed", String(state.role === key));
    ui.roles.append(button);
  }
}

function renderBooks() {
  ui.books.replaceChildren();
  const query = state.search.toLocaleLowerCase().trim();
  const books = state.books.filter((book) => book.level === state.level && (state.role === "all" || book.role === state.role) && (!query || book.title.toLocaleLowerCase().includes(query)));
  ui.bookCount.textContent = `${books.length} mục`;
  if (!books.length) {
    ui.books.append(element("p", "book-empty", "Không tìm thấy tài liệu phù hợp."));
    return;
  }
  for (const book of books) {
    const button = element("button", `book-button${book.id === state.book?.id ? " active" : ""}`);
    button.type = "button";
    button.dataset.book = book.id;
    const copy = element("span", "book-copy");
    copy.append(element("strong", "", book.title), element("small", "", `${book.pages} trang · ${ROLES.find(([key]) => key === book.role)?.[1] || "Tài liệu"}`));
    button.append(element("span", "book-icon", book.role === "student" ? "SB" : book.role === "workbook" ? "WB" : "Aa"), copy);
    ui.books.append(button);
  }
}

function renderPageGrid() {
  ui.pageGrid.replaceChildren();
  if (!state.bookData) return;
  const fragment = document.createDocumentFragment();
  for (let number = 1; number <= state.bookData.pages.length; number++) {
    const button = element("button", `page-chip${number === state.page ? " active" : ""}${state.progress.has(pageKey(state.book, number)) ? " done" : ""}`, String(number));
    button.type = "button";
    button.dataset.page = String(number);
    button.setAttribute("aria-label", `Trang ${number}${state.progress.has(pageKey(state.book, number)) ? ", đã học" : ""}`);
    fragment.append(button);
  }
  ui.pageGrid.append(fragment);
}

function setTab(tab) {
  state.tab = tab;
  ui.tabs.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  ui.listenPanel.hidden = tab !== "listen";
  ui.readPanel.hidden = tab !== "read";
  ui.writePanel.hidden = tab !== "write";
}

function levelAudio() { return state.audio.filter((item) => item.level === state.level); }
function isSoundEffect(item) { return /\/(?:badscore_boo|clap_loud|clap_mild|correct|wrong)\.aif$/i.test(item.path); }
function matchingTracks(page) {
  if (!page?.tracks?.length) return [];
  const refs = new Set(page.tracks);
  return levelAudio().filter((item) => refs.has(item.track)).slice(0, 12);
}

function audioButton(item, suggested = false) {
  const button = element("button", `audio-row${state.selectedAudioId === item.id ? " active" : ""}`);
  button.type = "button";
  button.dataset.audio = item.id;
  const copy = element("span");
  copy.append(element("strong", "", item.title || item.name), element("small", "", suggested ? item.path : `${item.topic || "Audio"} · ${item.path}`));
  button.append(element("span", "", "▶"), copy);
  return button;
}

function renderAudio() {
  const page = currentPage();
  const suggested = matchingTracks(page);
  ui.suggestedAudio.replaceChildren();
  if (suggested.length) {
    ui.suggestedAudio.append(element("span", "eyebrow", "TRACK GỢI Ý CHO TRANG NÀY"));
    for (const item of suggested) ui.suggestedAudio.append(audioButton(item, true));
  }
  ui.audioList.replaceChildren();
  const query = state.audioSearch.toLocaleLowerCase().trim();
  const filtered = levelAudio().filter((item) => !query || `${item.name} ${item.title || ""} ${item.path} ${item.track || ""}`.toLocaleLowerCase().includes(query));
  if (!query) filtered.sort((first, second) => Number(isSoundEffect(first)) - Number(isSoundEffect(second)));
  ui.moreAudio.hidden = filtered.length <= state.audioLimit;
  for (const item of filtered.slice(0, state.audioLimit)) ui.audioList.append(audioButton(item));
  if (!filtered.length) ui.audioList.append(element("p", "empty-audio", state.audio.length ? "Không tìm thấy audio. Hãy thử mã track hoặc tên khác." : "Audio đang được chuẩn bị cho cấp độ này."));
}

function selectedText() {
  const text = window.getSelection()?.toString().trim() || "";
  return text.slice(0, 300);
}

function renderActivities(page) {
  ui.activityList.replaceChildren();
  const activities = page.activities || [];
  if (!activities.length) {
    ui.activityList.append(element("p", "activity-empty", "Trang này chưa nhận dạng được câu hỏi. Bạn có thể viết câu trả lời vào phần ghi chú bên dưới."));
    return;
  }
  ui.activityList.append(element("h4", "activity-heading", "CÂU HỎI TỪ TRANG HỌC"));
  activities.forEach((prompt, index) => {
    const card = element("div", "activity-card");
    const label = element("label", "", `${index + 1}. ${prompt}`);
    const answer = element("textarea");
    const key = `${pageKey(state.book, state.page)}:${index}`;
    answer.value = state.answers[key] || "";
    answer.placeholder = "Viết câu trả lời của bạn...";
    answer.dataset.answer = key;
    label.append(answer);
    card.append(label);
    ui.activityList.append(card);
  });
}

function renderPage() {
  const page = currentPage();
  if (!page) return;
  ui.pageNumber.value = String(state.page);
  ui.pageNumber.max = String(state.bookData.pages.length);
  ui.pageTotal.textContent = `/ ${state.bookData.pages.length}`;
  ui.previous.disabled = state.page === 1;
  ui.next.disabled = state.page === state.bookData.pages.length;
  const key = pageKey(state.book, state.page);
  const complete = state.progress.has(key);
  ui.markPage.textContent = complete ? "✓ Đã học · Bỏ đánh dấu" : "✓ Đánh dấu đã học";
  ui.completedCount.textContent = String(state.bookData.pages.filter((item) => state.progress.has(pageKey(state.book, item.number))).length);
  ui.pageImage.src = page.image;
  ui.pageImage.alt = `${state.book.title}, trang ${state.page}`;
  ui.pageCaption.textContent = `${levelName(state.book.level)} · ${state.book.title} · Trang ${state.page}`;
  ui.pageTopics.textContent = (page.topics || []).map((name) => TOPIC_NAMES[name] || name).join(" · ");
  ui.pageText.textContent = page.text || "";
  renderActivities(page);
  ui.notes.value = state.notes[key] || "";
  ui.notesStatus.textContent = "Tự động lưu khi bạn nhập.";
  renderPageGrid();
  renderAudio();
  state.last = { bookId: state.book.id, page: state.page };
  saveStorage(LAST_KEY, state.last);
}

async function openBook(book, pageNumber = book.startPage || 1) {
  const token = ++state.bookToken;
  ui.loadStatus.hidden = false;
  ui.loadStatus.textContent = "Đang tải bài học…";
  ui.content.hidden = true;
  try {
    const response = await fetch(`./lesson-data/${encodeURIComponent(book.id)}.json`);
    if (!response.ok) throw new Error(`Không tải được sách (${response.status}).`);
    const data = await response.json();
    if (token !== state.bookToken) return;
    if (!Array.isArray(data.pages) || !data.pages.length) throw new Error("Sách chưa có trang học.");
    state.book = book;
    state.bookData = data;
    state.page = Math.min(data.pages.length, Math.max(1, Number(pageNumber) || 1));
    state.level = book.level;
    localStorage.setItem(LEVEL_KEY, state.level);
    ui.eyebrow.textContent = `${levelName(book.level).toUpperCase()} · ${ROLES.find(([key]) => key === book.role)?.[1].toUpperCase() || "TÀI LIỆU"}`;
    ui.title.textContent = book.title;
    ui.subtitle.textContent = `${data.pages.length} trang học · Ảnh trang được chuyển từ tài liệu PDF của bạn`;
    ui.loadStatus.hidden = true;
    ui.content.hidden = false;
    renderLevels();
    renderRoles();
    renderBooks();
    renderPage();
  } catch (error) {
    if (token === state.bookToken) ui.loadStatus.textContent = error.message || "Không tải được bài học.";
  }
}

function goToPage(number) {
  if (!state.bookData) return;
  const next = Math.min(state.bookData.pages.length, Math.max(1, Number(number) || 1));
  if (next === state.page) return;
  state.page = next;
  renderPage();
  if (matchMedia("(max-width: 760px)").matches) ui.content.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateOnline() { ui.onlineStatus.textContent = navigator.onLine ? "Sẵn sàng" : "Ngoại tuyến"; }
async function playAudio(item) {
  const base = state.audioSources[item.level];
  if (!base) {
    ui.audioTitle.textContent = "Audio chưa được triển khai";
    ui.audioPath.textContent = "Vui lòng thử lại sau khi nguồn audio được kết nối.";
    return;
  }
  const url = `${base.replace(/\/$/, "")}/audio/${encodeURIComponent(item.id)}.mp3`;
  state.selectedAudioId = item.id;
  ui.audioTitle.textContent = item.title || item.name;
  ui.audioPath.textContent = item.path;
  ui.audio.src = url;
  ui.audio.playbackRate = Number(ui.audioSpeed.value);
  ui.audio.loop = ui.audioRepeat.checked;
  renderAudio();
  try { await ui.audio.play(); } catch { /* user can press the native play control */ }
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    ui.recordButton.classList.remove("recording");
    ui.recordButton.setAttribute("aria-label", "Bắt đầu ghi âm");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    ui.recordStatus.textContent = "Trình duyệt này chưa hỗ trợ ghi âm.";
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.chunks = [];
    state.recorder = new MediaRecorder(state.stream);
    state.recorder.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
    state.recorder.onstop = () => {
      if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
      state.recordingUrl = URL.createObjectURL(new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" }));
      ui.recordingPlayback.src = state.recordingUrl;
      ui.recordingPlayback.hidden = false;
      ui.recordStatus.textContent = "Đã ghi xong. Nghe lại để tự so sánh với audio mẫu.";
    };
    state.recorder.start();
    ui.recordButton.classList.add("recording");
    ui.recordButton.setAttribute("aria-label", "Dừng ghi âm");
    ui.recordStatus.textContent = "Đang ghi âm… Bấm lần nữa để dừng.";
  } catch {
    ui.recordStatus.textContent = "Không truy cập được micro. Hãy cấp quyền trong trình duyệt.";
  }
}

ui.levels.addEventListener("click", (event) => {
  const button = event.target.closest("[data-level]");
  if (!button || button.dataset.level === state.level) return;
  state.level = button.dataset.level;
  state.role = "student";
  state.search = "";
  state.audioSearch = "";
  ui.bookSearch.value = "";
  ui.audioSearch.value = "";
  localStorage.setItem(LEVEL_KEY, state.level);
  localStorage.setItem(ROLE_KEY, state.role);
  renderLevels(); renderRoles(); renderBooks(); renderAudio();
  const first = state.books.find((book) => book.level === state.level && book.role === "student");
  if (first) openBook(first);
});
ui.roles.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  state.role = button.dataset.role;
  localStorage.setItem(ROLE_KEY, state.role);
  renderRoles(); renderBooks();
});
ui.bookSearch.addEventListener("input", () => { state.search = ui.bookSearch.value; renderBooks(); });
ui.books.addEventListener("click", (event) => {
  const button = event.target.closest("[data-book]");
  const book = state.books.find((item) => item.id === button?.dataset.book);
  if (book) openBook(book);
});
ui.previous.addEventListener("click", () => goToPage(state.page - 1));
ui.next.addEventListener("click", () => goToPage(state.page + 1));
ui.pageNumber.addEventListener("change", () => goToPage(ui.pageNumber.value));
ui.togglePages.addEventListener("click", () => {
  ui.pageGrid.hidden = !ui.pageGrid.hidden;
  ui.togglePages.setAttribute("aria-expanded", String(!ui.pageGrid.hidden));
});
ui.pageGrid.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) goToPage(button.dataset.page); });
ui.markPage.addEventListener("click", () => {
  if (!state.book) return;
  const key = pageKey(state.book, state.page);
  if (state.progress.has(key)) state.progress.delete(key); else state.progress.add(key);
  saveStorage(PROGRESS_KEY, [...state.progress]);
  renderPage();
});
ui.tabs.addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (button) setTab(button.dataset.tab); });
ui.audioSearch.addEventListener("input", () => { state.audioSearch = ui.audioSearch.value; state.audioLimit = 24; renderAudio(); });
for (const container of [ui.audioList, ui.suggestedAudio]) container.addEventListener("click", (event) => {
  const button = event.target.closest("[data-audio]");
  const item = state.audio.find((audio) => audio.id === button?.dataset.audio);
  if (item) playAudio(item);
});
ui.moreAudio.addEventListener("click", () => { state.audioLimit += 24; renderAudio(); });
ui.audioSpeed.addEventListener("change", () => { ui.audio.playbackRate = Number(ui.audioSpeed.value); });
ui.audioRepeat.addEventListener("change", () => { ui.audio.loop = ui.audioRepeat.checked; });
ui.recordButton.addEventListener("click", toggleRecording);
ui.activityList.addEventListener("input", (event) => {
  const answer = event.target.closest("[data-answer]");
  if (!answer) return;
  if (answer.value) state.answers[answer.dataset.answer] = answer.value;
  else delete state.answers[answer.dataset.answer];
  saveStorage(ANSWERS_KEY, state.answers);
});
ui.notes.addEventListener("input", () => {
  clearTimeout(state.noteTimer);
  ui.notesStatus.textContent = "Đang lưu…";
  const key = pageKey(state.book, state.page);
  const value = ui.notes.value;
  state.noteTimer = setTimeout(() => {
    if (value) state.notes[key] = value; else delete state.notes[key];
    ui.notesStatus.textContent = saveStorage(NOTES_KEY, state.notes) ? "Đã lưu trên trình duyệt này." : "Bộ nhớ trình duyệt đã đầy; hãy sao chép ghi chú để lưu riêng.";
  }, 350);
});
ui.textSearch.addEventListener("input", () => {
  const query = ui.textSearch.value.toLocaleLowerCase().trim();
  ui.textSearchResults.replaceChildren();
  ui.textSearchResults.hidden = !query;
  if (!query || !state.bookData) return;
  const matches = state.bookData.pages.filter((page) => page.text?.toLocaleLowerCase().includes(query));
  ui.textSearchResults.append(document.createTextNode(`Tìm thấy trong ${matches.length} trang: `));
  for (const page of matches.slice(0, 24)) {
    const button = element("button", "text-button", String(page.number));
    button.type = "button";
    button.addEventListener("click", () => goToPage(page.number));
    ui.textSearchResults.append(button);
  }
});
ui.practiceSelection.addEventListener("click", () => {
  const text = selectedText();
  if (!text) { ui.practiceSelection.textContent = "Hãy bôi đen một đoạn ở trên"; setTimeout(() => { ui.practiceSelection.textContent = "Luyện phát âm đoạn đã chọn ↗"; }, 2200); return; }
  location.href = `./pronunciation.html?practice=${encodeURIComponent(text)}`;
});
ui.speakSelection.addEventListener("click", () => {
  const text = selectedText();
  if (!text || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
});
ui.pageImage.addEventListener("click", () => { ui.zoomImage.src = ui.pageImage.src; ui.zoomOverlay.hidden = false; document.body.style.overflow = "hidden"; });
function closeZoom() { ui.zoomOverlay.hidden = true; ui.zoomImage.removeAttribute("src"); document.body.style.overflow = ""; }
ui.closeZoom.addEventListener("click", closeZoom);
ui.zoomOverlay.addEventListener("click", (event) => { if (event.target === ui.zoomOverlay) closeZoom(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.zoomOverlay.hidden) closeZoom();
  if (!state.bookData || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  if (event.key === "ArrowLeft") goToPage(state.page - 1);
  if (event.key === "ArrowRight") goToPage(state.page + 1);
});
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
window.addEventListener("beforeunload", () => {
  if (state.recorder?.state === "recording") state.recorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
});

async function init() {
  updateOnline();
  try {
    const [catalogResponse, audioResponse, sourcesResponse] = await Promise.all([
      fetch(CATALOG_URL), fetch(AUDIO_URL).catch(() => null), fetch(AUDIO_SOURCES_URL).catch(() => null),
    ]);
    if (!catalogResponse.ok) throw new Error("Chưa tải được lộ trình học. Hãy thử tải lại trang.");
    const catalog = await catalogResponse.json();
    state.levels = catalog.levels || [];
    state.books = catalog.books || [];
    if (audioResponse?.ok) state.audio = (await audioResponse.json()).files || [];
    if (sourcesResponse?.ok) state.audioSources = (await sourcesResponse.json()).levels || {};
    if (!state.levels.some(([key]) => key === state.level)) state.level = state.levels[0]?.[0] || "1.BEGINNER";
    if (!ROLES.some(([key]) => key === state.role)) state.role = "student";
    renderLevels(); renderRoles(); renderBooks();
    const lastBook = state.books.find((book) => book.id === state.last?.bookId);
    const firstBook = state.books.find((book) => book.level === state.level && book.role === "student") || state.books[0];
    if (lastBook) {
      state.level = lastBook.level;
      state.role = lastBook.role;
      await openBook(lastBook, state.last.page);
    } else if (firstBook) await openBook(firstBook);
    else throw new Error("Chưa có bài học trong lộ trình.");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (error) {
    ui.loadStatus.textContent = error.message || "Không tải được lộ trình học.";
  }
}
init();
