const STORAGE_KEY = "sayback-items-v1";
const IPA_CACHE_KEY = "sayback-ipa-v1";
const $ = (selector) => document.querySelector(selector);

const ui = {
  addForm: $("#add-form"),
  bulkInput: $("#bulk-input"),
  searchInput: $("#search-input"),
  itemList: $("#item-list"),
  itemCount: $("#item-count"),
  empty: $("#empty-state"),
  detail: $("#detail-view"),
  detailType: $("#detail-type"),
  detailTitle: $("#detail-title"),
  detailSubtitle: $("#detail-subtitle"),
  wordFields: $("#word-fields"),
  fieldText: $("#field-text"),
  fieldType: $("#field-type"),
  fieldIpa: $("#field-ipa"),
  fieldPartOfSpeech: $("#field-part-of-speech"),
  fieldFamily: $("#field-family"),
  fieldExample: $("#field-example"),
  fieldMeaning: $("#field-meaning"),
  ipaHint: $("#ipa-hint"),
  practiceText: $("#practice-text"),
  lookupNotice: $("#lookup-notice"),
  lookupButton: $("#lookup-button"),
  googleLink: $("#google-link"),
  speakButton: $("#speak-button"),
  slowButton: $("#slow-button"),
  voiceHint: $("#voice-hint"),
  recordButton: $("#record-button"),
  recordStatus: $("#record-status"),
  playbackBlock: $("#playback-block"),
  recordingAudio: $("#recording-audio"),
  recordTime: $("#record-time"),
  connectionLabel: $("#connection-label"),
  toast: $("#toast"),
};

const state = {
  items: loadItems(),
  selectedId: null,
  filter: "all",
  search: "",
  recorder: null,
  stream: null,
  chunks: [],
  recordingId: null,
  recordingStartedAt: 0,
  recordingUrl: null,
  recordingLoadId: 0,
  toastTimer: null,
};

function loadItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x) => x && typeof x.id === "string" && typeof x.text === "string",
      )
      .map((x) => ({
        id: x.id,
        type: x.type === "sentence" ? "sentence" : "word",
        text: x.text.slice(0, 300),
        ipa: String(x.ipa || ""),
        partOfSpeech: String(x.partOfSpeech || ""),
        family: String(x.family || ""),
        example: String(x.example || ""),
        meaning: String(x.meaning || ""),
        createdAt: Number(x.createdAt) || Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveItems() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    return true;
  } catch {
    toast(
      "Bộ nhớ trình duyệt đã đầy hoặc không khả dụng. Hãy xuất danh sách để sao lưu.",
    );
    return false;
  }
}

function currentItem() {
  return state.items.find((item) => item.id === state.selectedId);
}
function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function normalizeText(text) {
  return text.trim().replace(/\s+/g, " ");
}

function parseLine(line) {
  const parts = line.split("|").map((part) => part.trim());
  let text = normalizeText(parts[0] || "");
  let forcedType = null;
  const prefix = text.match(/^(word|sentence|từ|câu)\s*:\s*/i);
  if (prefix) {
    forcedType = /^(word|từ)$/i.test(prefix[1]) ? "word" : "sentence";
    text = normalizeText(text.slice(prefix[0].length));
  }
  if (!text || text.length > 300) return null;
  const type = forcedType || (/\s/.test(text) ? "sentence" : "word");
  return {
    id: newId(),
    type,
    text,
    meaning: parts[1] || "",
    ipa: parts[2] || "",
    partOfSpeech: "",
    family: "",
    example: "",
    createdAt: Date.now(),
  };
}

function addLines(raw) {
  const lines = raw.split(/\r?\n/).map(parseLine).filter(Boolean);
  const known = new Set(
    state.items.map(
      (item) => `${item.type}:${item.text.toLocaleLowerCase("en")}`,
    ),
  );
  const added = [];
  for (const item of lines) {
    const key = `${item.type}:${item.text.toLocaleLowerCase("en")}`;
    if (!known.has(key)) {
      known.add(key);
      added.push(item);
    }
  }
  if (!added.length) {
    toast(
      lines.length
        ? "Các mục này đã có trong danh sách."
        : "Hãy nhập ít nhất một từ hoặc câu.",
    );
    return;
  }
  state.items.push(...added);
  saveItems();
  state.selectedId = added[0].id;
  state.search = "";
  ui.searchInput.value = "";
  state.filter = "all";
  updateFilterButtons();
  render();
  scrollToDetailOnMobile();
  toast(`Đã thêm ${added.length} mục vào danh sách.`);
}

function scrollToDetailOnMobile() {
  if (matchMedia("(max-width: 720px)").matches && state.selectedId) {
    requestAnimationFrame(() =>
      ui.detail.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
}

function updateFilterButtons() {
  document
    .querySelectorAll(".filter")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.filter === state.filter),
    );
}

function renderList() {
  ui.itemCount.textContent = String(state.items.length);
  ui.itemList.replaceChildren();
  const items = state.items.filter(
    (item) =>
      (state.filter === "all" || item.type === state.filter) &&
      (!state.search ||
        `${item.text} ${item.meaning}`
          .toLocaleLowerCase()
          .includes(state.search)),
  );
  if (!items.length) {
    const message = document.createElement("p");
    message.className = "list-empty";
    message.textContent = state.items.length
      ? "Không tìm thấy mục phù hợp."
      : "Danh sách đang trống. Thêm mục ở phía trên nhé.";
    ui.itemList.append(message);
    return;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-row ${item.type}${item.id === state.selectedId ? " selected" : ""}`;
    button.dataset.id = item.id;
    button.setAttribute(
      "aria-current",
      item.id === state.selectedId ? "true" : "false",
    );
    const glyph = document.createElement("span");
    glyph.className = "item-glyph";
    glyph.textContent = item.type === "word" ? "Aa" : "“”";
    const copy = document.createElement("span");
    copy.className = "item-copy";
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.text;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent =
      item.ipa || (item.type === "word" ? "Từ vựng" : "Câu luyện tập");
    const arrow = document.createElement("span");
    arrow.className = "item-arrow";
    arrow.textContent = "›";
    copy.append(name, meta);
    button.append(glyph, copy, arrow);
    ui.itemList.append(button);
  }
}

function renderDetail() {
  const item = currentItem();
  ui.empty.hidden = Boolean(item);
  ui.detail.hidden = !item;
  if (!item) return;
  ui.detailType.textContent =
    item.type === "word" ? "TỪ VỰNG" : "CÂU LUYỆN TẬP";
  ui.detailTitle.textContent = item.text;
  ui.detailSubtitle.textContent =
    item.ipa || "Thêm phiên âm IPA để dễ theo dõi cách đọc";
  ui.fieldText.value = item.text;
  ui.fieldType.value = item.type;
  ui.fieldIpa.value = item.ipa;
  ui.fieldPartOfSpeech.value = item.partOfSpeech;
  ui.fieldFamily.value = item.family;
  ui.fieldExample.value = item.example;
  ui.fieldMeaning.value = item.meaning;
  ui.wordFields.hidden = item.type !== "word";
  ui.ipaHint.textContent =
    item.type === "sentence" ? "từng từ, chỉ mang tính tham khảo" : "";
  ui.practiceText.textContent = item.text;
  const search =
    item.type === "word"
      ? `${item.text} pronunciation meaning word family`
      : `${item.text} pronunciation translation Vietnamese`;
  ui.googleLink.href = `https://www.google.com/search?q=${encodeURIComponent(search)}`;
  hideNotice();
  ui.recordStatus.textContent =
    "Sẵn sàng ghi âm. Hãy nói rõ ràng trong môi trường yên tĩnh.";
  loadRecording(item.id);
}

function render() {
  renderList();
  renderDetail();
}

function selectItem(id) {
  if (state.selectedId === id) return;
  if (state.recorder?.state === "recording") state.recorder.stop();
  state.selectedId = id;
  render();
  scrollToDetailOnMobile();
}

function updateField(key, value) {
  const item = currentItem();
  if (!item) return;
  item[key] = value;
  saveItems();
  if (key === "text") {
    ui.detailTitle.textContent = value || "Chưa có nội dung";
    ui.practiceText.textContent = value;
    const search =
      item.type === "word"
        ? `${value} pronunciation meaning word family`
        : `${value} pronunciation translation Vietnamese`;
    ui.googleLink.href = `https://www.google.com/search?q=${encodeURIComponent(search)}`;
  }
  if (key === "ipa")
    ui.detailSubtitle.textContent =
      value || "Thêm phiên âm IPA để dễ theo dõi cách đọc";
  if (key === "text" || key === "ipa" || key === "meaning") renderList();
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 3600);
}

function showNotice(message, error = false) {
  ui.lookupNotice.hidden = false;
  ui.lookupNotice.classList.toggle("error", error);
  ui.lookupNotice.textContent = message;
}
function hideNotice() {
  ui.lookupNotice.hidden = true;
  ui.lookupNotice.textContent = "";
}

function updateConnection() {
  const offline = !navigator.onLine;
  ui.connectionLabel.textContent = offline ? "Đang ngoại tuyến" : "Sẵn sàng";
  ui.connectionLabel.classList.toggle("offline", offline);
}

async function fetchJSON(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeIpa(value) {
  const text = String(value || "")
    .trim()
    .replace(/^[/\[\s]+|[/\]\s]+$/g, "");
  return text ? `/${text}/` : "";
}

async function getWordMetadata(term) {
  const query = new URLSearchParams({
    sp: term,
    qe: "sp",
    md: "pr",
    ipa: "1",
    max: "1",
  });
  const rows = await fetchJSON(`https://api.datamuse.com/words?${query}`);
  const tags = rows?.[0]?.tags || [];
  const tag = tags.find((value) => value.startsWith("ipa_pron:"));
  const partNames = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
  return {
    ipa: tag ? normalizeIpa(tag.slice("ipa_pron:".length)) : "",
    partOfSpeech: tags
      .filter((value) => partNames[value])
      .map((value) => partNames[value])
      .join(", "),
  };
}

async function getPronunciation(term) {
  return (await getWordMetadata(term)).ipa;
}

async function getSentenceIpa(sentence) {
  const words = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
  if (!words.length) return "";
  const unique = [
    ...new Set(words.map((word) => word.toLocaleLowerCase("en"))),
  ];
  if (unique.length > 24)
    throw new Error(
      "Câu quá dài để tra IPA tự động. Hãy nhập phiên âm thủ công.",
    );
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(IPA_CACHE_KEY) || "{}") || {};
  } catch {
    /* Cache is optional. */
  }
  const results = await Promise.all(
    unique.map(async (word) => {
      if (cache[word]) return [word, cache[word]];
      try {
        return [word, await getPronunciation(word)];
      } catch {
        return [word, ""];
      }
    }),
  );
  const found = Object.fromEntries(results);
  if (Object.values(found).every((value) => !value)) return "";
  for (const [word, ipa] of results) if (ipa) cache[word] = ipa;
  try {
    localStorage.setItem(IPA_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* Lookup still works. */
  }
  return `/${words.map((word) => (found[word.toLocaleLowerCase("en")] || word).replace(/^\//, "").replace(/\/$/, "")).join(" ")}/`;
}

async function translateToVietnamese(text) {
  const query = new URLSearchParams({ q: text, langpair: "en|vi" });
  const result = await fetchJSON(
    `https://api.mymemory.translated.net/get?${query}`,
  );
  if (Number(result.responseStatus) !== 200)
    throw new Error("Không lấy được bản dịch.");
  return String(result.responseData?.translatedText || "").trim();
}

async function lookupWord(text) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`;
  const rows = await fetchJSON(url, 25000);
  const entry =
    rows.find(
      (row) =>
        row.word?.toLocaleLowerCase("en") === text.toLocaleLowerCase("en"),
    ) || rows[0];
  const meanings = entry?.meanings || [];
  const example =
    meanings
      .flatMap((meaning) => meaning.definitions || [])
      .find((definition) => definition.example)?.example || "";
  const ipa =
    entry?.phonetics?.find((phonetic) => phonetic.text)?.text ||
    entry?.phonetic ||
    "";
  return {
    ipa: normalizeIpa(ipa),
    partOfSpeech: [
      ...new Set(
        meanings.map((meaning) => meaning.partOfSpeech).filter(Boolean),
      ),
    ].join(", "),
    example,
  };
}

async function suggestFamily(text) {
  if (text.length < 4 || !/^[a-z]+$/i.test(text)) return "";
  const query = new URLSearchParams({ sp: `${text}*`, max: "25" });
  const rows = await fetchJSON(`https://api.datamuse.com/words?${query}`);
  return rows
    .map((row) => row.word)
    .filter(
      (word) =>
        /^[a-z]+$/i.test(word) &&
        word.toLocaleLowerCase("en") !== text.toLocaleLowerCase("en") &&
        word.length <= text.length + 8,
    )
    .slice(0, 5)
    .join(", ");
}

async function lookupCurrent() {
  const item = currentItem();
  if (!item) return;
  if (!navigator.onLine) {
    showNotice(
      "Cần mạng để tra cứu mới. Các mục đã lưu vẫn dùng được ngoại tuyến.",
      true,
    );
    return;
  }
  const id = item.id;
  const text = item.text.trim();
  if (!text) {
    showNotice("Hãy nhập nội dung tiếng Anh trước khi tra cứu.", true);
    return;
  }
  ui.lookupButton.disabled = true;
  showNotice("Đang tra cứu. Các thông tin bạn đã nhập sẽ được giữ nguyên.");
  const jobs = [translateToVietnamese(text).then((meaning) => ({ meaning }))];
  if (item.type === "word") {
    jobs.push(lookupWord(text));
    jobs.push(suggestFamily(text).then((family) => ({ family })));
    jobs.push(getWordMetadata(text));
  } else jobs.push(getSentenceIpa(text).then((ipa) => ({ ipa })));
  const results = await Promise.allSettled(jobs);
  const target = state.items.find((x) => x.id === id);
  if (!target) {
    ui.lookupButton.disabled = false;
    return;
  }
  let filled = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [key, value] of Object.entries(result.value)) {
      if (!target[key] && value) {
        target[key] = value;
        filled++;
      }
    }
  }
  saveItems();
  if (state.selectedId === id) {
    renderList();
    renderDetail();
    showNotice(
      filled
        ? `Đã điền ${filled} trường còn trống. Hãy kiểm tra lại nghĩa, IPA và word family trước khi học.`
        : "Chưa tìm được thông tin mới. Bạn có thể nhập trực tiếp hoặc dùng liên kết Google bên dưới.",
      !filled,
    );
  }
  ui.lookupButton.disabled = false;
}

function getEnglishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  const local = voices.filter(
    (voice) => /^en[-_]/i.test(voice.lang) && voice.localService === true,
  );
  return (
    local.find((voice) => /^en[-_]US$/i.test(voice.lang)) || local[0] || null
  );
}

function updateVoiceHint() {
  const voice = getEnglishVoice();
  ui.voiceHint.textContent = voice
    ? `Giọng mẫu trên thiết bị: ${voice.name}.`
    : "Chưa tìm thấy giọng tiếng Anh trên thiết bị. Hãy cài giọng tiếng Anh trong hệ điều hành để nghe mẫu ngoại tuyến.";
  ui.speakButton.disabled = !voice;
  ui.slowButton.disabled = !voice;
}

function speak(rate) {
  const item = currentItem();
  const voice = getEnglishVoice();
  if (!item || !voice) {
    toast("Thiết bị chưa có giọng tiếng Anh cục bộ.");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = voice.lang;
  utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

function openRecordingDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB không khả dụng"));
      return;
    }
    const request = indexedDB.open("sayback-recordings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function recordingStore(mode, operation) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("recordings", mode);
    const request = operation(transaction.objectStore("recordings"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function saveRecording(id, blob) {
  return recordingStore("readwrite", (store) => store.put(blob, id));
}
function getRecording(id) {
  return recordingStore("readonly", (store) => store.get(id));
}
function deleteRecording(id) {
  return recordingStore("readwrite", (store) => store.delete(id));
}

function clearRecordingPlayer() {
  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = null;
  ui.recordingAudio.removeAttribute("src");
  ui.recordingAudio.load();
  ui.playbackBlock.hidden = true;
}

function showRecording(blob) {
  clearRecordingPlayer();
  state.recordingUrl = URL.createObjectURL(blob);
  ui.recordingAudio.src = state.recordingUrl;
  ui.playbackBlock.hidden = false;
}

async function loadRecording(id) {
  const loadId = ++state.recordingLoadId;
  clearRecordingPlayer();
  try {
    const blob = await getRecording(id);
    if (loadId !== state.recordingLoadId || state.selectedId !== id) return;
    if (blob) showRecording(blob);
  } catch {
    /* Recording storage is optional; microphone still works. */
  }
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }
  const item = currentItem();
  if (!item) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast(
      "Trình duyệt này không hỗ trợ ghi âm. Hãy mở web bằng HTTPS trên Chrome hoặc Edge.",
    );
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    state.stream = stream;
    state.chunks = [];
    state.recordingId = item.id;
    state.recordingStartedAt = Date.now();
    const recorder = new MediaRecorder(stream);
    state.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    recorder.onstop = async () => {
      const id = state.recordingId;
      const duration = Math.max(
        1,
        Math.round((Date.now() - state.recordingStartedAt) / 1000),
      );
      const blob = new Blob(state.chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
      state.recorder = null;
      ui.recordButton.classList.remove("recording");
      ui.recordButton.setAttribute("aria-label", "Bắt đầu ghi âm");
      if (id && blob.size) {
        try {
          await saveRecording(id, blob);
        } catch {
          toast("Đã ghi âm nhưng không lưu được bản ghi trên thiết bị.");
        }
        if (state.selectedId === id) {
          showRecording(blob);
          ui.recordTime.textContent = `${duration} giây`;
          ui.recordStatus.textContent =
            "Đã ghi âm xong. Hãy nghe lại và so với giọng mẫu.";
        }
      }
    };
    recorder.start();
    ui.recordButton.classList.add("recording");
    ui.recordButton.setAttribute("aria-label", "Dừng ghi âm");
    ui.recordStatus.textContent = "Đang ghi âm... Nhấn nút đỏ lần nữa để dừng.";
  } catch (error) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    toast(
      error?.name === "NotAllowedError"
        ? "Bạn cần cho phép trình duyệt dùng micro."
        : "Không mở được micro. Hãy kiểm tra quyền truy cập và thử lại.",
    );
  }
}

function exportItems() {
  const content = JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), items: state.items },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `sayback-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importItems(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items))
      throw new Error("Tệp không đúng định dạng SayBack.");
    const known = new Set(
      state.items.map(
        (item) => `${item.type}:${item.text.toLocaleLowerCase("en")}`,
      ),
    );
    const added = [];
    for (const raw of data.items) {
      if (!raw || typeof raw.text !== "string") continue;
      const text = normalizeText(raw.text).slice(0, 300);
      if (!text) continue;
      const type = raw.type === "sentence" ? "sentence" : "word";
      const key = `${type}:${text.toLocaleLowerCase("en")}`;
      if (known.has(key)) continue;
      known.add(key);
      added.push({
        id: newId(),
        type,
        text,
        ipa: String(raw.ipa || "").slice(0, 500),
        partOfSpeech: String(raw.partOfSpeech || "").slice(0, 200),
        family: String(raw.family || "").slice(0, 500),
        example: String(raw.example || "").slice(0, 1000),
        meaning: String(raw.meaning || "").slice(0, 1000),
        createdAt: Date.now(),
      });
    }
    if (!added.length) {
      toast("Tệp không có mục mới để nhập.");
      return;
    }
    state.items.push(...added);
    state.selectedId = added[0].id;
    saveItems();
    render();
    toast(`Đã nhập ${added.length} mục.`);
  } catch (error) {
    toast(error.message || "Không đọc được tệp JSON.");
  }
}

ui.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addLines(ui.bulkInput.value);
  ui.bulkInput.value = "";
  ui.addForm.classList.remove("mobile-open");
  $("#mobile-add-toggle").setAttribute("aria-expanded", "false");
});
$("#mobile-add-toggle").addEventListener("click", (event) => {
  const open = ui.addForm.classList.toggle("mobile-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
ui.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.toLocaleLowerCase().trim();
  renderList();
});
ui.itemList.addEventListener("click", (event) => {
  const row = event.target.closest(".item-row");
  if (row) selectItem(row.dataset.id);
});
document.querySelectorAll(".filter").forEach((button) =>
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    updateFilterButtons();
    renderList();
  }),
);
$("#add-samples-button").addEventListener("click", () =>
  addLines(
    "pronunciation | phát âm\nI am learning English. | Tôi đang học tiếng Anh.\nword: confident | tự tin",
  ),
);
$("#delete-button").addEventListener("click", async () => {
  const item = currentItem();
  if (!item || !confirm(`Xóa “${item.text}” khỏi danh sách?`)) return;
  if (state.recorder?.state === "recording") {
    state.recordingId = null;
    state.recorder.stop();
  }
  state.items = state.items.filter((x) => x.id !== item.id);
  state.selectedId = state.items[0]?.id || null;
  saveItems();
  render();
  try {
    await deleteRecording(item.id);
  } catch {
    /* Ignore if storage is unavailable. */
  }
  toast("Đã xóa mục.");
});
ui.fieldText.addEventListener("input", (event) =>
  updateField("text", event.target.value),
);
ui.fieldType.addEventListener("change", (event) => {
  const item = currentItem();
  if (!item) return;
  item.type = event.target.value;
  saveItems();
  render();
});
ui.fieldIpa.addEventListener("input", (event) =>
  updateField("ipa", event.target.value),
);
ui.fieldPartOfSpeech.addEventListener("input", (event) =>
  updateField("partOfSpeech", event.target.value),
);
ui.fieldFamily.addEventListener("input", (event) =>
  updateField("family", event.target.value),
);
ui.fieldExample.addEventListener("input", (event) =>
  updateField("example", event.target.value),
);
ui.fieldMeaning.addEventListener("input", (event) =>
  updateField("meaning", event.target.value),
);
ui.lookupButton.addEventListener("click", lookupCurrent);
ui.speakButton.addEventListener("click", () => speak(1));
ui.slowButton.addEventListener("click", () => speak(0.75));
ui.recordButton.addEventListener("click", toggleRecording);
$("#remove-recording-button").addEventListener("click", async () => {
  const item = currentItem();
  if (!item) return;
  try {
    await deleteRecording(item.id);
  } catch {
    /* Still clear player. */
  }
  clearRecordingPlayer();
  ui.recordStatus.textContent =
    "Đã xóa bản ghi. Bạn có thể ghi lại bất cứ lúc nào.";
});
$("#export-button").addEventListener("click", exportItems);
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) await importItems(file);
  event.target.value = "";
});
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
if ("speechSynthesis" in window)
  speechSynthesis.addEventListener("voiceschanged", updateVoiceHint);
if ("serviceWorker" in navigator && location.protocol !== "file:")
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {}),
  );

state.selectedId = state.items[0]?.id || null;
updateConnection();
updateVoiceHint();
render();
