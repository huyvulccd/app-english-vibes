import { LEVELS, STAGES, splitSegments, tokenizeWords, normalizeWord, compareWords, nextReview, translationPrompt } from "./practice-core.mjs";

const $ = (id) => document.getElementById(id);
const DATA_URLS = ["./vocabulary-data.json", "./news-data.json"];
const KEYS = {
  reviews: "sayback-vocabulary-reviews-v1", custom: "sayback-vocabulary-custom-v1",
  meanings: "sayback-vocabulary-meanings-v1", level: "sayback-vocabulary-level-v1",
};
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { showToast("Không lưu được tiến độ. Bộ nhớ trình duyệt có thể đã đầy."); return false; } }
const state = {
  vocabulary: [], news: [], reviews: readStore(KEYS.reviews, {}), custom: readStore(KEYS.custom, []), meanings: readStore(KEYS.meanings, {}),
  level: localStorage.getItem(KEYS.level) || "B1", view: "vocabulary", session: null, selectedWord: null,
  shadowArticle: null, shadowIndex: 0, shadowRecordings: new Map(),
  dictationArticle: null, dictationIndex: 0, dictationSpeed: 1, dictationAnswers: new Map(), dictationResults: null,
  translationDirection: "en-vi", translationArticle: null, translationDrafts: new Map(),
  customArticles: {}, recorder: null, stream: null, recordPending: false, recordRequest: 0, vocabUrl: null,
};
let toastTimer;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3800);
}
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function compactMeaning(value) { return String(value || "").split(";")[0].trim(); }
function cardKey(card) { return normalizeWord(card.word); }
function cardList() {
  return [...state.vocabulary, ...state.custom].map((card) => ({ ...card, meaning: state.meanings[cardKey(card)] || card.meaning }));
}
function findCard(word) { return cardList().find((card) => cardKey(card) === normalizeWord(word)); }
function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
function say(text, rate = 1, language = "en-US") {
  if (!window.speechSynthesis) { showToast("Trình duyệt này chưa có giọng đọc."); return; }
  speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = language;
  speech.rate = rate;
  const voices = speechSynthesis.getVoices();
  speech.voice = voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase() && voice.localService) || voices.find((voice) => voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()) && voice.localService) || null;
  speechSynthesis.speak(speech);
}
function switchView(view) {
  if (!["vocabulary", "shadowing", "dictation", "translation"].includes(view)) return;
  if (state.recordPending || state.recorder?.state === "recording") stopRecording();
  state.view = view;
  document.querySelectorAll(".view").forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll(".nav-tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (location.hash !== `#${view}`) history.replaceState(null, "", `${location.pathname}#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function levelCards() { return cardList().filter((card) => card.level === state.level && card.meaning); }
function renderOverview() {
  const cards = levelCards();
  const now = Date.now();
  const reviewed = cards.filter((card) => state.reviews[cardKey(card)]);
  const due = reviewed.filter((card) => state.reviews[cardKey(card)].due <= now);
  $("vocab-total").textContent = state.vocabulary.length.toLocaleString("vi-VN");
  $("level-word-count").textContent = `${cards.length.toLocaleString("vi-VN")} từ`;
  $("due-count").textContent = String(due.length);
  $("new-count").textContent = String(cards.length - reviewed.length);
  $("learned-count").textContent = String(reviewed.length);
  document.querySelectorAll(".level-switch button").forEach((button) => button.classList.toggle("active", button.dataset.level === state.level));
  $("custom-level").value = state.level;
}
function renderWordResults() {
  const query = normalizeWord($("word-search").value);
  const cards = levelCards();
  const filtered = query
    ? cards.filter((card) => card.word.includes(query) || card.meaning.toLocaleLowerCase("vi").includes(query)).slice(0, 35)
    : cards.filter((card) => state.reviews[cardKey(card)]).sort((a, b) => (state.reviews[a.word]?.due || 0) - (state.reviews[b.word]?.due || 0)).slice(0, 20);
  const list = $("word-results");
  list.replaceChildren();
  if (!filtered.length) {
    list.append(node("p", "small-note", query ? "Không thấy từ phù hợp ở cấp độ này." : "Tìm một từ để xem và sửa nghĩa trước khi học."));
    return;
  }
  for (const card of filtered) {
    const button = node("button", "word-row");
    button.type = "button";
    button.dataset.word = card.word;
    const copy = node("span");
    copy.append(node("strong", "", card.word), node("small", "", compactMeaning(card.meaning)));
    const status = state.reviews[cardKey(card)] ? "Đang ôn" : card.pos || "Xem";
    button.append(copy, node("em", "", status));
    list.append(button);
  }
}
function updateVocabulary() { renderOverview(); renderWordResults(); }
function selectReviewCards() {
  const now = Date.now();
  const cards = levelCards();
  const due = cards.filter((card) => state.reviews[cardKey(card)]?.due <= now).sort((a, b) => state.reviews[cardKey(a)].due - state.reviews[cardKey(b)].due);
  const fresh = cards.filter((card) => !state.reviews[cardKey(card)]).sort((a, b) => (a.tier || 9) - (b.tier || 9) || (b.frequency || 0) - (a.frequency || 0));
  return [...due.slice(0, 10), ...fresh.slice(0, Math.max(0, 10 - due.length))];
}
function startReview() {
  const cards = selectReviewCards();
  if (!cards.length) { showToast("Chưa có từ đến hạn. Hãy tìm và thêm một từ ở kho bên phải."); return; }
  state.session = { cards, index: 0, stage: 0, answered: false, wrong: false, completed: 0, errors: 0 };
  $("review-overview").hidden = true;
  $("review-finished").hidden = true;
  $("review-session").hidden = false;
  renderQuestion();
}
function currentCard() { return state.session?.cards[state.session.index]; }
function makeOptions(card, type) {
  const target = type === "meaning" ? compactMeaning(card.meaning) : card.word;
  const pool = levelCards().filter((item) => item.word !== card.word && item.pos === card.pos);
  const picked = [];
  const used = new Set([target.toLocaleLowerCase("vi")]);
  for (const item of shuffle(pool)) {
    const answer = type === "meaning" ? compactMeaning(item.meaning) : item.word;
    if (!answer || used.has(answer.toLocaleLowerCase("vi"))) continue;
    picked.push(answer);
    used.add(answer.toLocaleLowerCase("vi"));
    if (picked.length === 3) break;
  }
  if (picked.length < 3) for (const item of shuffle(levelCards())) {
    const answer = type === "meaning" ? compactMeaning(item.meaning) : item.word;
    if (!answer || used.has(answer.toLocaleLowerCase("vi"))) continue;
    picked.push(answer);
    used.add(answer.toLocaleLowerCase("vi"));
    if (picked.length === 3) break;
  }
  return shuffle([target, ...picked]);
}
async function renderQuestion() {
  const session = state.session;
  const card = currentCard();
  if (!session || !card) return;
  const stage = STAGES[session.stage];
  session.answered = false;
  $("session-position").textContent = `${session.index + 1} / ${session.cards.length}`;
  $("session-stage").textContent = `${session.stage + 1} / 4 · ${{ meaning: "Chọn nghĩa", listening: "Nghe từ", spelling: "Viết từ", pronunciation: "Phát âm" }[stage]}`;
  $("session-meter-fill").style.width = `${((session.index * 4 + session.stage) / (session.cards.length * 4)) * 100}%`;
  $("choice-options").hidden = !["meaning", "listening"].includes(stage);
  $("spelling-form").hidden = stage !== "spelling";
  $("pronunciation-tools").hidden = stage !== "pronunciation";
  $("question-speak").hidden = stage === "meaning" || stage === "spelling";
  $("answer-feedback").hidden = true;
  $("answer-feedback").classList.remove("incorrect");
  $("next-question").hidden = true;
  if (stage === "meaning") {
    $("question-kicker").textContent = "CHỌN NGHĨA ĐÚNG";
    $("question-title").textContent = card.word;
    $("question-helper").textContent = `Từ loại: ${card.pos || "—"}. Chọn một trong bốn nghĩa tiếng Việt.`;
  } else if (stage === "listening") {
    $("question-kicker").textContent = "NGHE VÀ NHẬN DIỆN";
    $("question-title").textContent = "Bạn nghe thấy từ nào?";
    $("question-helper").textContent = "Bấm “Nghe từ” rồi chọn từ tiếng Anh đúng.";
  } else if (stage === "spelling") {
    $("question-kicker").textContent = "VIẾT LẠI TỪ";
    $("question-title").textContent = compactMeaning(card.meaning);
    $("question-helper").textContent = "Viết từ tiếng Anh tương ứng với nghĩa trên.";
    $("spelling-input").value = "";
    setTimeout(() => $("spelling-input").focus(), 50);
  } else {
    $("question-kicker").textContent = "NÓI VÀ TỰ ĐÁNH GIÁ";
    $("question-title").textContent = card.word;
    $("question-helper").textContent = `${card.pos || "Từ vựng"} · ${card.meaning}`;
    $("vocab-record-status").textContent = "Bản ghi gần nhất của từ này được lưu trong trình duyệt.";
    await showSavedVocabRecording(card.word);
  }
  if (["meaning", "listening"].includes(stage)) {
    const options = makeOptions(card, stage);
    const box = $("choice-options");
    box.replaceChildren();
    for (const option of options) {
      const button = node("button", "", option);
      button.type = "button";
      button.dataset.option = option;
      box.append(button);
    }
  }
}
function checkAnswer(answer) {
  const session = state.session;
  if (!session || session.answered) return;
  const card = currentCard();
  const stage = STAGES[session.stage];
  const correctAnswer = stage === "meaning" ? compactMeaning(card.meaning) : card.word;
  const correct = normalizeWord(answer) === normalizeWord(correctAnswer);
  session.answered = true;
  if (!correct) { session.wrong = true; session.errors++; }
  const feedback = $("answer-feedback");
  feedback.hidden = false;
  feedback.classList.toggle("incorrect", !correct);
  feedback.textContent = correct ? `Đúng rồi. ${card.word} — ${card.meaning}` : `Chưa đúng. Đáp án: ${correctAnswer}. ${card.word} — ${card.meaning}`;
  if (stage !== "spelling") $("choice-options").querySelectorAll("button").forEach((button) => {
    button.disabled = true;
    button.classList.toggle("correct", normalizeWord(button.dataset.option) === normalizeWord(correctAnswer));
    button.classList.toggle("wrong", button.dataset.option === answer && !correct);
  });
  $("next-question").hidden = false;
  $("next-question").focus();
}
function nextStage() {
  if (!state.session?.answered) return;
  state.session.stage++;
  renderQuestion();
}
function completeCard(rating) {
  const session = state.session;
  if (!session) return;
  const card = currentCard();
  const key = cardKey(card);
  const finalRating = session.wrong ? "again" : rating;
  state.reviews[key] = nextReview(state.reviews[key], finalRating);
  saveStore(KEYS.reviews, state.reviews);
  session.completed++;
  session.index++;
  session.stage = 0;
  session.wrong = false;
  updateVocabulary();
  if (session.index >= session.cards.length) {
    $("review-session").hidden = true;
    $("review-finished").hidden = false;
    $("finished-count").textContent = String(session.completed);
    $("finished-summary").textContent = session.errors ? `${session.errors} câu cần luyện lại. Những từ này sẽ xuất hiện sớm trong lịch ôn.` : "Bạn đã đi hết bốn bước cho mỗi từ. Hẹn gặp lại ở lượt ôn tiếp theo.";
  } else renderQuestion();
}

function openWord(word) {
  const card = findCard(word);
  if (!card) return;
  state.selectedWord = card.word;
  $("dialog-level").textContent = `${card.level} · ${card.pos || "TỪ VỰNG"}`;
  $("dialog-word").textContent = card.word;
  $("dialog-definition").textContent = card.definition || "Nghĩa gợi ý có thể được sửa trước khi học.";
  $("dialog-meaning").value = card.meaning;
  $("word-dialog").showModal();
}
function saveWordDialog() {
  const card = findCard(state.selectedWord);
  const meaning = $("dialog-meaning").value.trim();
  if (!card || !meaning) { showToast("Hãy nhập nghĩa tiếng Việt."); return; }
  state.meanings[cardKey(card)] = meaning;
  saveStore(KEYS.meanings, state.meanings);
  const previous = state.reviews[cardKey(card)];
  state.reviews[cardKey(card)] = { ...(previous || {}), due: Date.now() - 1 };
  saveStore(KEYS.reviews, state.reviews);
  $("word-dialog").close();
  updateVocabulary();
  showToast(`Đã đưa “${card.word}” vào lượt ôn.`);
}
function addCustomWord(word, meaning, level = state.level, source = "custom") {
  const cleanWord = normalizeWord(word);
  if (!/^[a-z][a-z'-]{0,35}$/i.test(cleanWord) || !meaning.trim()) return false;
  const existing = findCard(cleanWord);
  if (existing) state.meanings[cleanWord] = meaning.trim();
  else state.custom.push({ word: cleanWord, meaning: meaning.trim(), level: LEVELS.includes(level) ? level : "B1", pos: "word", definition: source === "dictation" ? "Từ lưu từ bài chép chính tả" : "Từ do bạn thêm", source });
  saveStore(KEYS.custom, state.custom);
  saveStore(KEYS.meanings, state.meanings);
  state.reviews[cleanWord] = { ...(state.reviews[cleanWord] || {}), due: Date.now() - 1 };
  saveStore(KEYS.reviews, state.reviews);
  return true;
}

let recordingDatabase;
function openRecordingDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
  recordingDatabase ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("sayback-practice-recordings-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vocabulary");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return recordingDatabase;
}
async function saveVocabRecording(word, blob) {
  const database = await openRecordingDatabase();
  await new Promise((resolve, reject) => {
    const request = database.transaction("vocabulary", "readwrite").objectStore("vocabulary").put(blob, normalizeWord(word));
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}
async function getVocabRecording(word) {
  const database = await openRecordingDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("vocabulary", "readonly").objectStore("vocabulary").get(normalizeWord(word));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function showSavedVocabRecording(word) {
  const playback = $("vocab-recording");
  if (state.vocabUrl) URL.revokeObjectURL(state.vocabUrl);
  state.vocabUrl = null;
  playback.removeAttribute("src");
  playback.hidden = true;
  try {
    const blob = await getVocabRecording(word);
    if (blob && currentCard()?.word === word && STAGES[state.session.stage] === "pronunciation") {
      state.vocabUrl = URL.createObjectURL(blob);
      playback.src = state.vocabUrl;
      playback.hidden = false;
    }
  } catch { /* recording still works when browser storage is unavailable */ }
}
function stopRecording() {
  state.recordRequest++;
  if (state.recorder?.state === "recording") state.recorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  $("vocab-record").textContent = "● Ghi âm";
  $("shadow-record").classList.remove("recording");
  $("shadow-record").setAttribute("aria-label", "Bắt đầu ghi âm");
}
async function toggleRecording(kind, key) {
  if (state.recorder?.state === "recording") { stopRecording(); return; }
  if (state.recordPending) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showToast("Trình duyệt này chưa hỗ trợ ghi âm."); return; }
  const requestId = ++state.recordRequest;
  state.recordPending = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (requestId !== state.recordRequest) { stream.getTracks().forEach((track) => track.stop()); return; }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    state.stream = stream;
    state.recorder = recorder;
    state.recordKind = kind;
    state.recordKey = key;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (!blob.size) return;
      if (kind === "vocabulary") {
        try {
          await saveVocabRecording(key, blob);
          if (currentCard()?.word === key) {
            await showSavedVocabRecording(key);
            $("vocab-record-status").textContent = "Đã lưu bản ghi. Nghe lại rồi tự đánh giá.";
          }
        } catch { $("vocab-record-status").textContent = "Đã ghi xong nhưng trình duyệt không lưu được bản ghi."; }
      } else if (kind === "shadowing") {
        const prior = state.shadowRecordings.get(key);
        if (prior) URL.revokeObjectURL(prior.url);
        const url = URL.createObjectURL(blob);
        state.shadowRecordings.set(key, { blob, url });
        $("shadow-record-count").textContent = String(state.shadowRecordings.size);
        renderShadowing();
      }
    };
    recorder.start();
    if (kind === "vocabulary") { $("vocab-record").textContent = "■ Dừng ghi"; $("vocab-record-status").textContent = "Đang ghi âm…"; }
    else { $("shadow-record").classList.add("recording"); $("shadow-record").setAttribute("aria-label", "Dừng ghi âm"); $("shadow-record-status").textContent = "Đang ghi âm. Bấm lần nữa để dừng."; }
  } catch { if (requestId === state.recordRequest) showToast("Không dùng được micro. Hãy cấp quyền ghi âm cho trang này."); }
  finally { state.recordPending = false; }
}

function storyById(id) { return state.news.find((story) => story.id === id) || Object.values(state.customArticles).find((story) => story.id === id); }
function fillArticleSelect(selectId, language, currentId) {
  const select = $(selectId);
  select.replaceChildren();
  const groups = new Map();
  for (const story of state.news.filter((item) => item.language === language)) {
    if (!groups.has(story.source)) groups.set(story.source, []);
    groups.get(story.source).push(story);
  }
  for (const [source, stories] of groups) {
    const group = node("optgroup");
    group.label = source;
    for (const story of stories) {
      const option = node("option", "", story.title);
      option.value = story.id;
      group.append(option);
    }
    select.append(group);
  }
  const custom = Object.values(state.customArticles).find((item) => item.id === currentId);
  if (custom && custom.language === language) {
    const option = node("option", "", custom.title);
    option.value = custom.id;
    select.prepend(option);
  }
  if (currentId && [...select.options].some((option) => option.value === currentId)) select.value = currentId;
  else select.selectedIndex = 0;
  return storyById(select.value) || null;
}
function renderArticleMeta(target, story) {
  target.replaceChildren();
  if (!story) return;
  if (story.url) {
    const link = node("a", "", `${story.source} · Đọc bài gốc ↗`);
    link.href = story.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    target.append(link);
  } else target.append(node("span", "", story.source));
  if (story.date) target.append(node("span", "", ` · ${new Date(story.date).toLocaleDateString("vi-VN")}`));
  if (story.url) target.append(node("span", "", " · Tiêu đề và tóm tắt RSS"));
}
function useCustomArticle(mode, language, textareaId) {
  const text = $(textareaId).value.replace(/\s+/g, " ").trim();
  if (text.length < 30) { showToast("Hãy dán ít nhất 30 ký tự để bắt đầu."); return; }
  const article = { id: `custom-${mode}-${Date.now()}`, title: text.slice(0, 58) + (text.length > 58 ? "…" : ""), text, language, source: "Văn bản của bạn", url: null, date: null };
  state.customArticles[mode] = article;
  if (mode === "shadowing") { state.shadowArticle = article; state.shadowIndex = 0; renderShadowing(true); }
  else if (mode === "dictation") { state.dictationArticle = article; state.dictationIndex = 0; renderDictation(true); }
  else { state.translationArticle = article; renderTranslation(true); }
  showToast("Đã tạo bài luyện từ văn bản bạn dán.");
}
function articleSegments(article) { return splitSegments(article?.text || ""); }
function shadowKey(article, index) { return `${article?.id || "none"}:${index}`; }
function renderSegments(container, segments, index, statusFor) {
  container.replaceChildren();
  segments.forEach((segment, position) => {
    const button = node("button", position === index ? "active" : "");
    button.type = "button";
    button.dataset.segment = String(position);
    button.append(node("span", "", segment), node("strong", "", statusFor(position) ? `✓ ${position + 1}` : String(position + 1)));
    container.append(button);
  });
}
function renderShadowing(rebuildSelect = false) {
  if (rebuildSelect) state.shadowArticle = fillArticleSelect("shadow-article", "en", state.shadowArticle?.id);
  const article = state.shadowArticle;
  if (!article) return;
  const segments = articleSegments(article);
  state.shadowIndex = Math.min(Math.max(0, state.shadowIndex), segments.length - 1);
  renderArticleMeta($("shadow-article-meta"), article);
  renderSegments($("shadow-segments"), segments, state.shadowIndex, (index) => state.shadowRecordings.has(shadowKey(article, index)));
  $("shadow-counter").textContent = `ĐOẠN ${state.shadowIndex + 1} / ${segments.length}`;
  $("shadow-text").textContent = segments[state.shadowIndex] || "";
  $("shadow-prev").disabled = state.shadowIndex === 0;
  $("shadow-next").disabled = state.shadowIndex >= segments.length - 1;
  const recording = state.shadowRecordings.get(shadowKey(article, state.shadowIndex));
  const playback = $("shadow-playback");
  playback.hidden = !recording;
  if (recording) playback.src = recording.url; else playback.removeAttribute("src");
  $("shadow-record-marker").textContent = recording ? "Đã ghi đoạn này" : "Chưa ghi";
  $("shadow-record-status").textContent = recording ? "Bản ghi đã được giữ trong phiên này. Nghe lại hoặc ghi lại." : "Bấm ghi âm và đọc đoạn phía trên.";
  $("shadow-record-count").textContent = String(state.shadowRecordings.size);
}
function setShadowIndex(index) {
  if (state.recordPending || state.recorder?.state === "recording") stopRecording();
  state.shadowIndex = index;
  renderShadowing();
}

function dictationKey(article, index) { return `${article?.id || "none"}:${index}`; }
function storeDictationAnswer() {
  const article = state.dictationArticle;
  if (!article) return;
  state.dictationAnswers.set(dictationKey(article, state.dictationIndex), $("dictation-answer").value);
}
function renderDictation(rebuildSelect = false) {
  if (rebuildSelect) state.dictationArticle = fillArticleSelect("dictation-article", "en", state.dictationArticle?.id);
  const article = state.dictationArticle;
  if (!article) return;
  const segments = articleSegments(article);
  state.dictationIndex = Math.min(Math.max(0, state.dictationIndex), segments.length - 1);
  renderArticleMeta($("dictation-article-meta"), article);
  renderSegments($("dictation-segments"), segments, state.dictationIndex, (index) => Boolean(state.dictationAnswers.get(dictationKey(article, index))?.trim()));
  $("dictation-counter").textContent = `ĐOẠN ${state.dictationIndex + 1} / ${segments.length}`;
  $("dictation-answer").value = state.dictationAnswers.get(dictationKey(article, state.dictationIndex)) || "";
  $("dictation-draft-count").textContent = `${segments.filter((_, index) => state.dictationAnswers.get(dictationKey(article, index))?.trim()).length} / ${segments.length} đoạn đã viết`;
  $("dictation-prev").disabled = state.dictationIndex === 0;
  $("dictation-next").disabled = state.dictationIndex >= segments.length - 1;
  document.querySelectorAll(".speed-switch button").forEach((button) => button.classList.toggle("active", Number(button.dataset.speed) === state.dictationSpeed));
  $("dictation-work").hidden = false;
  $("dictation-results").hidden = true;
}
function setDictationIndex(index) {
  storeDictationAnswer();
  state.dictationIndex = index;
  renderDictation();
}
function renderUnknownWords(article, comparisons) {
  const mistakes = new Set(comparisons.flatMap((result) => result.operations.filter((item) => ["missing", "substitute"].includes(item.kind)).map((item) => normalizeWord(item.expected))));
  const common = new Set("the a an and or but if to of in on at by for with from as is are was were be been being have has had do does did this that these those it its he she they we you i my your their his her our about after before into over under can will would should could not no yes more most very one two new said say says which who what when where how than then them there here also today".split(" "));
  const words = [...new Set(tokenizeWords(article.text).map(normalizeWord))]
    .filter((word) => /^[a-z][a-z'-]*$/i.test(word))
    .sort((a, b) => Number(mistakes.has(b)) - Number(mistakes.has(a)) || Number(common.has(a)) - Number(common.has(b)) || a.localeCompare(b));
  const list = $("unknown-words");
  list.replaceChildren();
  for (const word of words) {
    const card = findCard(word);
    const label = node("label", `unknown-row${mistakes.has(word) ? " mistake" : ""}`);
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.value = word;
    const body = node("span");
    body.append(node("strong", "", word));
    const meaning = node("input");
    meaning.type = "text";
    meaning.value = card?.meaning || "";
    meaning.placeholder = "Nhập nghĩa tiếng Việt";
    meaning.setAttribute("aria-label", `Nghĩa của ${word}`);
    body.append(meaning);
    label.append(checkbox, body);
    list.append(label);
  }
  if (!words.length) list.append(node("p", "small-note", "Không tìm thấy từ phù hợp để thêm."));
}
function finishDictation() {
  storeDictationAnswer();
  const article = state.dictationArticle;
  if (!article) return;
  const segments = articleSegments(article);
  const comparisons = segments.map((segment, index) => compareWords(segment, state.dictationAnswers.get(dictationKey(article, index)) || ""));
  const totalWords = comparisons.reduce((sum, result) => sum + result.referenceWords, 0);
  const totalErrors = comparisons.reduce((sum, result) => sum + result.errors, 0);
  const accuracy = totalWords ? Math.max(0, Math.round((1 - totalErrors / totalWords) * 100)) : 100;
  state.dictationResults = comparisons;
  $("dictation-work").hidden = true;
  $("dictation-results").hidden = false;
  $("dictation-accuracy").textContent = `${accuracy}%`;
  $("dictation-result-detail").textContent = `${totalWords} từ trong bài · ${totalErrors} lỗi khác biệt (bỏ qua viết hoa và dấu câu).`;
  const list = $("dictation-comparison");
  list.replaceChildren();
  comparisons.forEach((result, index) => {
    const card = node("div", "comparison-card");
    card.append(node("small", "", `ĐOẠN ${index + 1} · ${result.accuracy}%`));
    const words = node("p", "");
    for (const operation of result.operations) {
      const span = node("span", operation.kind === "correct" ? "word-correct" : operation.kind === "extra" ? "word-extra" : "word-error", operation.expected || operation.actual);
      if (operation.kind === "substitute") span.title = `Bạn viết: ${operation.actual}`;
      else if (operation.kind === "missing") span.title = "Bạn chưa viết từ này";
      else if (operation.kind === "extra") span.title = "Từ viết thêm";
      words.append(span, document.createTextNode(" "));
    }
    card.append(words);
    list.append(card);
  });
  renderUnknownWords(article, comparisons);
  $("save-unknown-status").textContent = "";
  $("dictation-results").scrollIntoView({ behavior: "smooth", block: "start" });
}
function saveUnknownWords() {
  const selected = [...$("unknown-words").querySelectorAll(".unknown-row")].filter((row) => row.querySelector("input[type=checkbox]").checked);
  if (!selected.length) { $("save-unknown-status").textContent = "Hãy tích ít nhất một từ."; return; }
  const missing = selected.find((row) => !row.querySelector("input[type=text]").value.trim());
  if (missing) { missing.querySelector("input[type=text]").focus(); $("save-unknown-status").textContent = "Nhập nghĩa cho các từ đã chọn."; return; }
  let saved = 0;
  for (const row of selected) {
    const word = row.querySelector("input[type=checkbox]").value;
    const meaning = row.querySelector("input[type=text]").value;
    const existing = findCard(word);
    if (addCustomWord(word, meaning, existing?.level || "B1", "dictation")) saved++;
  }
  $("save-unknown-status").textContent = `Đã lưu ${saved} từ vào lịch ôn.`;
  selected.forEach((row) => { row.querySelector("input[type=checkbox]").checked = false; });
  updateVocabulary();
}

function translationKey() { return `${state.translationDirection}:${state.translationArticle?.id || "none"}`; }
function saveTranslationDraft() { state.translationDrafts.set(translationKey(), $("translation-answer").value); }
function renderTranslation(rebuildSelect = false) {
  const language = state.translationDirection === "en-vi" ? "en" : "vi";
  if (rebuildSelect) state.translationArticle = fillArticleSelect("translation-article", language, state.translationArticle?.id);
  const article = state.translationArticle;
  if (!article) return;
  document.querySelectorAll(".direction-switch button").forEach((button) => button.classList.toggle("active", button.dataset.direction === state.translationDirection));
  renderArticleMeta($("translation-article-meta"), article);
  $("translation-source-label").textContent = state.translationDirection === "en-vi" ? "BÀI GỐC · TIẾNG ANH" : "BÀI GỐC · TIẾNG VIỆT";
  $("translation-target-label").textContent = state.translationDirection === "en-vi" ? "BẢN DỊCH · TIẾNG VIỆT" : "BẢN DỊCH · TIẾNG ANH";
  $("translation-source").lang = language;
  $("translation-answer").lang = state.translationDirection === "en-vi" ? "vi" : "en";
  $("translation-source").textContent = article.text;
  $("translation-source-count").textContent = `${tokenizeWords(article.text).length} từ`;
  $("translation-answer").value = state.translationDrafts.get(translationKey()) || "";
  $("translation-answer-count").textContent = `${tokenizeWords($("translation-answer").value).length} từ`;
  $("translation-copy-status").textContent = "";
}
async function copyTranslation() {
  const article = state.translationArticle;
  const answer = $("translation-answer").value.trim();
  if (!article || !answer) { $("translation-copy-status").textContent = "Hãy viết bản dịch trước khi sao chép."; return; }
  const prompt = translationPrompt(state.translationDirection, article.text, answer);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    const fallback = node("textarea");
    fallback.value = prompt;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) { $("translation-copy-status").textContent = "Không sao chép được. Hãy cho phép truy cập clipboard."; return; }
  }
  $("translation-copy-status").textContent = "Đã sao chép bài dịch. Bạn chỉ cần dán vào ChatGPT, Gemini hoặc AI bạn dùng để được chấm điểm.";
}

document.querySelector(".main-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) switchView(button.dataset.view);
});
document.querySelector(".level-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-level]");
  if (!button) return;
  state.level = button.dataset.level;
  localStorage.setItem(KEYS.level, state.level);
  state.session = null;
  $("review-overview").hidden = false;
  $("review-session").hidden = true;
  $("review-finished").hidden = true;
  updateVocabulary();
});
$("start-review").addEventListener("click", startReview);
$("review-again").addEventListener("click", startReview);
$("choice-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-option]");
  if (button) checkAnswer(button.dataset.option);
});
$("spelling-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.session?.answered) return;
  checkAnswer($("spelling-input").value);
});
$("next-question").addEventListener("click", nextStage);
$("question-speak").addEventListener("click", () => { const card = currentCard(); if (card) say(card.word, 0.9); });
$("vocab-record").addEventListener("click", () => { const card = currentCard(); if (card) toggleRecording("vocabulary", card.word); });
document.querySelector(".rating-row").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (button) { if (state.recordPending || state.recorder?.state === "recording") stopRecording(); completeCard(button.dataset.rating); }
});
$("word-search").addEventListener("input", renderWordResults);
$("word-results").addEventListener("click", (event) => { const button = event.target.closest("[data-word]"); if (button) openWord(button.dataset.word); });
$("dialog-speak").addEventListener("click", () => { if (state.selectedWord) say(state.selectedWord, 0.9); });
$("dialog-save").addEventListener("click", saveWordDialog);
$("add-word-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const word = $("custom-word").value, meaning = $("custom-meaning").value;
  if (!addCustomWord(word, meaning, $("custom-level").value)) { showToast("Chỉ nhập một từ tiếng Anh và một nghĩa tiếng Việt."); return; }
  $("add-word-form").reset();
  updateVocabulary();
  showToast(`Đã thêm “${normalizeWord(word)}” vào lịch ôn.`);
});

$("shadow-article").addEventListener("change", () => {
  if (state.recordPending || state.recorder?.state === "recording") stopRecording();
  state.shadowArticle = storyById($("shadow-article").value);
  state.shadowIndex = 0;
  renderShadowing();
});
$("shadow-use-custom").addEventListener("click", () => useCustomArticle("shadowing", "en", "shadow-custom-text"));
$("shadow-segments").addEventListener("click", (event) => { const button = event.target.closest("[data-segment]"); if (button) setShadowIndex(Number(button.dataset.segment)); });
$("shadow-prev").addEventListener("click", () => setShadowIndex(state.shadowIndex - 1));
$("shadow-next").addEventListener("click", () => setShadowIndex(state.shadowIndex + 1));
$("shadow-speak").addEventListener("click", () => {
  const text = articleSegments(state.shadowArticle)[state.shadowIndex];
  if (text) say(text, Number($("shadow-speed").value));
});
$("shadow-record").addEventListener("click", () => { if (state.shadowArticle) toggleRecording("shadowing", shadowKey(state.shadowArticle, state.shadowIndex)); });

$("dictation-article").addEventListener("change", () => {
  storeDictationAnswer();
  state.dictationArticle = storyById($("dictation-article").value);
  state.dictationIndex = 0;
  renderDictation();
});
$("dictation-use-custom").addEventListener("click", () => { storeDictationAnswer(); useCustomArticle("dictation", "en", "dictation-custom-text"); });
$("dictation-segments").addEventListener("click", (event) => { const button = event.target.closest("[data-segment]"); if (button) setDictationIndex(Number(button.dataset.segment)); });
$("dictation-prev").addEventListener("click", () => setDictationIndex(state.dictationIndex - 1));
$("dictation-next").addEventListener("click", () => setDictationIndex(state.dictationIndex + 1));
$("dictation-answer").addEventListener("input", () => {
  storeDictationAnswer();
  const segments = articleSegments(state.dictationArticle);
  $("dictation-draft-count").textContent = `${segments.filter((_, index) => state.dictationAnswers.get(dictationKey(state.dictationArticle, index))?.trim()).length} / ${segments.length} đoạn đã viết`;
});
document.querySelector(".speed-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-speed]");
  if (!button) return;
  state.dictationSpeed = Number(button.dataset.speed);
  document.querySelectorAll(".speed-switch button").forEach((item) => item.classList.toggle("active", item === button));
});
$("dictation-speak").addEventListener("click", () => {
  const text = articleSegments(state.dictationArticle)[state.dictationIndex];
  if (text) say(text, state.dictationSpeed);
});
$("dictation-finish").addEventListener("click", finishDictation);
$("dictation-return").addEventListener("click", () => { $("dictation-results").hidden = true; $("dictation-work").hidden = false; });
$("save-unknown").addEventListener("click", saveUnknownWords);

document.querySelector(".direction-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button || button.dataset.direction === state.translationDirection) return;
  saveTranslationDraft();
  state.translationDirection = button.dataset.direction;
  state.translationArticle = null;
  renderTranslation(true);
});
$("translation-article").addEventListener("change", () => {
  saveTranslationDraft();
  state.translationArticle = storyById($("translation-article").value);
  renderTranslation();
});
$("translation-use-custom").addEventListener("click", () => { saveTranslationDraft(); useCustomArticle("translation", state.translationDirection === "en-vi" ? "en" : "vi", "translation-custom-text"); });
$("translation-answer").addEventListener("input", () => {
  saveTranslationDraft();
  $("translation-answer-count").textContent = `${tokenizeWords($("translation-answer").value).length} từ`;
});
$("translation-copy").addEventListener("click", copyTranslation);
window.addEventListener("hashchange", () => switchView(location.hash.slice(1)));
window.addEventListener("beforeunload", () => {
  if (state.recordPending || state.recorder?.state === "recording") stopRecording();
  if (state.vocabUrl) URL.revokeObjectURL(state.vocabUrl);
  for (const recording of state.shadowRecordings.values()) URL.revokeObjectURL(recording.url);
});

function migrateLegacyWords() {
  if (localStorage.getItem("sayback-vocab-migrated-v1")) return;
  const legacy = readStore("sayback-items-v1", []);
  let count = 0;
  for (const item of legacy) {
    if (item?.type !== "word" || typeof item.text !== "string") continue;
    const word = normalizeWord(item.text);
    const meaning = String(item.meaning || findCard(word)?.meaning || "").trim();
    if (!meaning || !/^[a-z][a-z'-]{0,35}$/i.test(word)) continue;
    if (addCustomWord(word, meaning, findCard(word)?.level || "B1", "legacy")) count++;
  }
  localStorage.setItem("sayback-vocab-migrated-v1", "1");
  if (count) showToast(`Đã đưa ${count} từ từ danh sách cũ vào lịch ôn.`);
}
async function init() {
  try {
    const responses = await Promise.all(DATA_URLS.map((url) => fetch(url)));
    if (responses.some((response) => !response.ok)) throw new Error("Không tải được dữ liệu học. Hãy tải lại trang.");
    const [vocabulary, news] = await Promise.all(responses.map((response) => response.json()));
    state.vocabulary = Array.isArray(vocabulary.cards) ? vocabulary.cards : [];
    state.news = Array.isArray(news.items) ? news.items : [];
    if (!state.vocabulary.length || !state.news.length) throw new Error("Dữ liệu học đang trống.");
    if (!LEVELS.includes(state.level)) state.level = "B1";
    migrateLegacyWords();
    updateVocabulary();
    state.shadowArticle = fillArticleSelect("shadow-article", "en");
    state.dictationArticle = fillArticleSelect("dictation-article", "en");
    state.translationArticle = fillArticleSelect("translation-article", "en");
    renderShadowing();
    renderDictation();
    renderTranslation();
    switchView(location.hash.slice(1) || "vocabulary");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (error) {
    showToast(error.message || "Không tải được dữ liệu học.");
    $("review-overview").querySelector("p").textContent = error.message || "Không tải được dữ liệu học.";
  }
}
init();
