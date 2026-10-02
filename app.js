import { parseResearchText } from "./research-parser.mjs";

const STORAGE_KEY = "sayback-items-v1";
const IPA_CACHE_KEY = "sayback-ipa-v1";
const $ = (selector) => document.querySelector(selector);

const ui = {
  addForm: $("#add-form"),
  bulkInput: $("#bulk-input"),
  searchInput: $("#search-input"),
  itemList: $("#item-list"),
  itemCount: $("#item-count"),
  batchButton: $("#batch-lookup-button"),
  batchProgress: $("#batch-progress"),
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
  researchGoogleLink: $("#research-google-link"),
  cambridgeLink: $("#cambridge-link"),
  researchPanel: $("#research-panel"),
  researchText: $("#research-text"),
  researchPreview: $("#research-preview"),
  ipaOptions: $("#ipa-options"),
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
  lookupPromises: new Map(),
  batch: null,
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
        lookupAttemptedAt: Number(x.lookupAttemptedAt) || 0,
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
    lookupAttemptedAt: 0,
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
  const pending = added.filter(needsLookup);
  if (navigator.onLine && pending.length)
    startBatchLookup(pending.map((item) => item.id));
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
  ui.batchButton.disabled = !state.items.length && !state.batch;
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
  updateResearchLinks(item);
  ui.lookupButton.disabled = state.lookupPromises.has(item.id);
  ui.researchPanel.open = false;
  ui.researchText.value = "";
  ui.researchPreview.hidden = true;
  ui.ipaOptions.hidden = true;
  ui.ipaOptions.replaceChildren();
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
    updateResearchLinks(item);
  }
  if (key === "ipa")
    ui.detailSubtitle.textContent =
      value || "Thêm phiên âm IPA để dễ theo dõi cách đọc";
  if (key === "text" || key === "ipa" || key === "meaning") renderList();
}

function updateResearchLinks(item) {
  const search =
    item.type === "word"
      ? `${item.text} pronunciation IPA meaning Vietnamese word family Cambridge`
      : `${item.text} IPA pronunciation translation Vietnamese`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(search)}`;
  ui.googleLink.href = googleUrl;
  ui.researchGoogleLink.href = googleUrl;
  ui.cambridgeLink.href = `https://dictionary.cambridge.org/search/english/direct/?q=${encodeURIComponent(item.text)}`;
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

async function mapWithConcurrency(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await task(values[index], index);
      }
    }),
  );
  return results;
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
  const results = await mapWithConcurrency(unique, 4, async (word) => {
    if (cache[word]) return [word, cache[word]];
    try {
      return [word, await getPronunciation(word)];
    } catch {
      return [word, ""];
    }
  });
  const found = Object.fromEntries(results);
  if (words.some((word) => !found[word.toLocaleLowerCase("en")])) return "";
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

async function lookupWord(text, timeoutMs = 18000) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`;
  const rows = await fetchJSON(url, timeoutMs);
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

function needsLookup(item) {
  return (
    !item.ipa ||
    !item.meaning ||
    (item.type === "word" &&
      (!item.partOfSpeech || !item.family || !item.example))
  );
}

function applyLookupResult(id, text, type, fields) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || item.text.trim() !== text || item.type !== type) return 0;
  const inputs = {
    ipa: ui.fieldIpa,
    partOfSpeech: ui.fieldPartOfSpeech,
    family: ui.fieldFamily,
    example: ui.fieldExample,
    meaning: ui.fieldMeaning,
  };
  let filled = 0;
  for (const [key, raw] of Object.entries(fields)) {
    const value = String(raw || "").trim();
    if (!inputs[key] || !value || String(item[key] || "").trim()) continue;
    item[key] = value;
    filled++;
    if (state.selectedId === id) {
      inputs[key].value = value;
      if (key === "ipa") ui.detailSubtitle.textContent = value;
    }
  }
  if (filled) {
    saveItems();
    if (state.selectedId === id) renderList();
  }
  return filled;
}

function lookupItem(id, batch = false) {
  if (state.lookupPromises.has(id)) return state.lookupPromises.get(id);
  const item = state.items.find((entry) => entry.id === id);
  if (!item || !item.text.trim() || !needsLookup(item))
    return Promise.resolve({ filled: 0, success: 0 });
  if (!navigator.onLine) {
    if (state.selectedId === id)
      showNotice(
        "Cần mạng để tra cứu mới. Dữ liệu đã lưu vẫn dùng được ngoại tuyến.",
        true,
      );
    return Promise.resolve({ filled: 0, success: 0 });
  }
  const text = item.text.trim();
  const type = item.type;
  const promise = (async () => {
    let filled = 0;
    let success = 0;
    if (state.selectedId === id)
      showNotice(
        "Đang tra cứu; mỗi kết quả sẽ hiện và được lưu ngay khi nhận được.",
      );
    const tasks = [
      () => translateToVietnamese(text).then((meaning) => ({ meaning })),
    ];
    if (type === "word") {
      tasks.push(() => getWordMetadata(text));
      tasks.push(() => suggestFamily(text).then((family) => ({ family })));
      tasks.push(() => lookupWord(text, batch ? 7000 : 18000));
    } else tasks.push(() => getSentenceIpa(text).then((ipa) => ({ ipa })));
    try {
      await Promise.all(
        tasks.map(async (task) => {
          try {
            const fields = await task();
            success++;
            filled += applyLookupResult(id, text, type, fields);
            if (state.selectedId === id && filled)
              showNotice(`Đã điền ${filled} ô; đang chờ các nguồn còn lại…`);
          } catch {
            /* One source can fail without blocking the others. */
          }
        }),
      );
      const target = state.items.find((entry) => entry.id === id);
      if (
        target &&
        target.text.trim() === text &&
        target.type === type &&
        success
      ) {
        target.lookupAttemptedAt = Date.now();
        saveItems();
      }
      if (state.selectedId === id)
        showNotice(
          filled
            ? `Đã lưu ${filled} ô mới. Bạn có thể kiểm tra và sửa nội dung bên dưới.`
            : "Không có ô trống nào được điền. Bạn có thể dán kết quả Google AI/Cambridge để chọn thủ công.",
          !filled,
        );
      return { filled, success };
    } finally {
      state.lookupPromises.delete(id);
      if (state.selectedId === id) ui.lookupButton.disabled = false;
    }
  })();
  state.lookupPromises.set(id, promise);
  if (state.selectedId === id) ui.lookupButton.disabled = true;
  return promise;
}

function updateBatchProgress(batch) {
  ui.batchProgress.hidden = false;
  ui.batchProgress.textContent = `Đã tra ${batch.done}/${batch.total} mục, điền ${batch.filled} ô. Kết quả nhận được đã lưu vào trình duyệt.`;
  ui.batchButton.textContent = batch.cancelled ? "Đang dừng…" : "Dừng tra cứu";
  ui.batchButton.disabled = batch.cancelled;
}

function startBatchLookup(ids) {
  if (!navigator.onLine) {
    toast("Cần mạng để tra cứu danh sách.");
    return;
  }
  const eligible = ids.filter((id) => {
    const item = state.items.find((entry) => entry.id === id);
    return item && needsLookup(item);
  });
  if (!eligible.length) {
    if (!state.batch) toast("Không có ô trống cần tra cứu.");
    return;
  }
  if (state.batch) {
    if (state.batch.cancelled) return;
    for (const id of eligible) {
      if (state.batch.scheduled.has(id)) continue;
      state.batch.scheduled.add(id);
      state.batch.queue.push(id);
      state.batch.total++;
    }
    updateBatchProgress(state.batch);
    return;
  }
  const batch = {
    queue: [...eligible],
    scheduled: new Set(eligible),
    done: 0,
    filled: 0,
    total: eligible.length,
    cancelled: false,
  };
  state.batch = batch;
  updateBatchProgress(batch);
  const worker = async () => {
    while (!batch.cancelled) {
      const id = batch.queue.shift();
      if (!id) break;
      try {
        const result = await lookupItem(id, true);
        batch.filled += result.filled;
      } catch {
        /* Continue with the next item if one lookup fails unexpectedly. */
      } finally {
        batch.done++;
        updateBatchProgress(batch);
      }
    }
  };
  Promise.all(
    Array.from({ length: Math.min(3, eligible.length) }, worker),
  ).finally(() => {
    if (state.batch !== batch) return;
    state.batch = null;
    ui.batchButton.textContent = "✦ Tra cứu toàn bộ danh sách";
    ui.batchButton.disabled = !state.items.length;
    ui.batchProgress.textContent = batch.cancelled
      ? `Đã dừng sau ${batch.done}/${batch.total} mục, điền ${batch.filled} ô. Mọi kết quả đã nhận vẫn được lưu.`
      : `Đã tra xong ${batch.done} mục, điền ${batch.filled} ô. Kết quả sẽ còn khi mở lại web.`;
  });
}

function lookupCurrent() {
  const item = currentItem();
  if (!item) return;
  if (!needsLookup(item)) {
    showNotice(
      "Các ô đã có dữ liệu. Hãy xóa ô muốn tra lại hoặc dùng phần dán kết quả để thay bằng dữ liệu bạn chọn.",
    );
    return;
  }
  lookupItem(item.id);
}

function previewInput(key) {
  return ui.researchPreview.querySelector(`[data-preview-field="${key}"]`);
}

function previewCheckbox(key) {
  return ui.researchPreview.querySelector(`[data-include-field="${key}"]`);
}

function setPreviewValue(key, value) {
  previewInput(key).value = value || "";
  previewCheckbox(key).checked = Boolean(value);
}

function showResearchPreview() {
  const item = currentItem();
  if (!item) return;
  ui.researchPreview.hidden = false;
  ui.researchPreview.querySelectorAll("[data-word-only]").forEach((row) => {
    row.hidden = item.type !== "word";
  });
}

function parseResearch() {
  const item = currentItem();
  if (!item) return;
  if (!ui.researchText.value.trim()) {
    toast("Hãy dán nội dung tra cứu trước.");
    return;
  }
  const result = parseResearchText(ui.researchText.value, item.type);
  showResearchPreview();
  for (const [key, value] of Object.entries(result.values))
    setPreviewValue(key, value);
  ui.ipaOptions.replaceChildren();
  for (const [label, value] of Object.entries(result.ipaOptions)) {
    if (!value) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${label.toUpperCase()}: ${value}`;
    button.addEventListener("click", () => setPreviewValue("ipa", value));
    ui.ipaOptions.append(button);
  }
  ui.ipaOptions.hidden = !ui.ipaOptions.childElementCount;
  const count = Object.values(result.values).filter(Boolean).length;
  toast(
    count
      ? `Đã nhận diện ${count} ô. Hãy kiểm tra trước khi lưu.`
      : "Chưa nhận ra trường nào. Bạn có thể bôi đen từng đoạn và gán vào ô cần điền.",
  );
}

function pickSelectedText(key) {
  const start = ui.researchText.selectionStart;
  const end = ui.researchText.selectionEnd;
  let value = ui.researchText.value.slice(start, end).trim();
  if (!value) {
    toast("Hãy bôi đen đoạn cần lấy trong ô nội dung sao chép.");
    return;
  }
  if (key === "ipa") {
    const ipa = value.match(/\/[^/\r\n]+\//);
    value = normalizeIpa(ipa ? ipa[0] : value);
  }
  showResearchPreview();
  setPreviewValue(key, value);
  previewInput(key).focus();
}

function applyResearch() {
  const item = currentItem();
  if (!item) return;
  let count = 0;
  for (const key of ["partOfSpeech", "ipa", "family", "example", "meaning"]) {
    if (item.type === "sentence" && !["ipa", "meaning"].includes(key)) continue;
    if (!previewCheckbox(key).checked) continue;
    const value = previewInput(key).value.trim();
    if (!value) continue;
    item[key] = key === "ipa" ? normalizeIpa(value) : value;
    count++;
  }
  if (!count) {
    toast("Hãy đánh dấu ít nhất một ô có giá trị.");
    return;
  }
  saveItems();
  render();
  showNotice(
    `Đã điền và lưu ${count} ô bạn chọn. Dữ liệu sẽ còn khi mở lại web.`,
  );
  toast(`Đã lưu ${count} ô.`);
}

async function copyResearchPrompt() {
  const item = currentItem();
  if (!item) return;
  const prompt =
    item.type === "word"
      ? `Hãy tra từ tiếng Anh "${item.text}" và trả lời ngắn theo đúng mẫu sau. Chỉ dùng thông tin chắc chắn; không biết thì để trống.\nLoại từ: \nIPA UK: /.../\nIPA US: /.../\nNghĩa tiếng Việt: \nWord family: \nVí dụ: `
      : `Hãy tra câu tiếng Anh "${item.text}" và trả lời ngắn theo đúng mẫu sau. Chỉ dùng thông tin chắc chắn; không biết thì để trống.\nIPA: /.../\nNghĩa tiếng Việt: `;
  try {
    await navigator.clipboard.writeText(prompt);
    toast(
      "Đã chép mẫu yêu cầu. Hãy dán vào Google AI rồi mang kết quả về đây.",
    );
  } catch {
    ui.researchText.value = prompt;
    ui.researchText.select();
    toast("Đã chọn mẫu yêu cầu; nhấn Ctrl+C để sao chép.");
  }
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
        lookupAttemptedAt: 0,
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
    const pending = added.filter(needsLookup);
    if (navigator.onLine && pending.length)
      startBatchLookup(pending.map((item) => item.id));
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
ui.batchButton.addEventListener("click", () => {
  if (state.batch) {
    state.batch.cancelled = true;
    updateBatchProgress(state.batch);
    return;
  }
  startBatchLookup(state.items.filter(needsLookup).map((item) => item.id));
});
$("#parse-research-button").addEventListener("click", parseResearch);
$("#apply-research-button").addEventListener("click", applyResearch);
$("#copy-prompt-button").addEventListener("click", copyResearchPrompt);
ui.researchPreview.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pick-field]");
  if (button) pickSelectedText(button.dataset.pickField);
});
ui.researchPreview.addEventListener("input", (event) => {
  const key = event.target.dataset.previewField;
  if (key) previewCheckbox(key).checked = Boolean(event.target.value.trim());
});
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
window.addEventListener("online", () => {
  updateConnection();
  const pending = state.items.filter(
    (item) => !item.lookupAttemptedAt && needsLookup(item),
  );
  if (pending.length) startBatchLookup(pending.map((item) => item.id));
});
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
const practiceFromLesson = new URLSearchParams(location.search).get("practice");
if (practiceFromLesson) {
  const text = normalizeText(practiceFromLesson.replace(/\|/g, "/")).slice(0, 300);
  if (text) {
    const existing = state.items.find((item) => item.type === "sentence" && item.text.toLocaleLowerCase("en") === text.toLocaleLowerCase("en"));
    if (existing) {
      state.selectedId = existing.id;
      render();
    } else addLines(`sentence: ${text}`);
  }
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
}
const pendingOnStart = state.items.filter(
  (item) => !item.lookupAttemptedAt && needsLookup(item),
);
if (navigator.onLine && pendingOnStart.length)
  startBatchLookup(pendingOnStart.map((item) => item.id));
