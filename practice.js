import { LEVELS, splitSegments, shadowSegments, tokenizeWords, normalizeWord, compareWords, nextReview, translationPrompt, pickNewCards, buildReviewQueue } from "./practice-core.mjs";
import { normalizeArticleUrl, articleSource, articleSelectors, cleanArticleText } from "./reader-core.mjs";

const $ = (id) => document.getElementById(id);
const DATA_URLS = ["./vocabulary-data.json", "./news-data.json"];
const KEYS = {
  reviews: "sayback-vocabulary-reviews-v1", custom: "sayback-vocabulary-custom-v1",
  meanings: "sayback-vocabulary-meanings-v1", definitions: "sayback-vocabulary-definitions-v1", ipa: "sayback-vocabulary-ipa-v1", level: "sayback-vocabulary-level-v1", voice: "sayback-english-voice-v1",
};
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { showToast("Không lưu được tiến độ. Bộ nhớ trình duyệt có thể đã đầy."); return false; } }
const state = {
  vocabulary: [], news: [], reviews: readStore(KEYS.reviews, {}), custom: readStore(KEYS.custom, []), meanings: readStore(KEYS.meanings, {}), definitions: readStore(KEYS.definitions, {}), ipa: readStore(KEYS.ipa, {}), voiceKey: localStorage.getItem(KEYS.voice) || "",
  level: localStorage.getItem(KEYS.level) || "B2", view: "vocabulary", session: null, selectedWord: null,
  shadowArticle: null, shadowIndex: 0, shadowRecordings: new Map(),
  dictationArticle: null, dictationIndex: 0, dictationSpeed: 1, dictationAnswers: new Map(), dictationResults: null,
  translationDirection: "en-vi", translationArticle: null, translationDrafts: new Map(),
  customArticles: {}, onlineArticles: new Map(), onlineControllers: {}, recorder: null, stream: null, recordPending: false, recordRequest: 0, vocabUrl: null,
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
function speakerButton(word) {
  const button = node("button", "word-audio speaker-button");
  button.type = "button";
  button.dataset.speakWord = word;
  button.setAttribute("aria-label", `Nghe phát âm ${word}`);
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm12-1a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14" /></svg>';
  return button;
}
function compactMeaning(value) { return String(value || "").split(";")[0].trim(); }
function cardKey(card) { return normalizeWord(card.word); }
function cardDefinitions(card) {
  const stored = state.definitions[cardKey(card)];
  const values = Array.isArray(stored) ? stored : Array.isArray(card.definitions) ? card.definitions : card.definition ? [card.definition] : [];
  return values.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2);
}
function cardIpa(card) { return state.ipa[cardKey(card)] ?? card.ipa ?? ""; }
function cardList() {
  return [...state.vocabulary, ...state.custom].map((card) => ({ ...card, meaning: state.meanings[cardKey(card)] || card.meaning, definitions: cardDefinitions(card), ipa: cardIpa(card) }));
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
function voiceKey(voice) { return voice.voiceURI || voice.name; }
function englishVoices() {
  if (!window.speechSynthesis) return [];
  return speechSynthesis.getVoices().filter((voice) => /^en(?:-|$)/i.test(voice.lang)).sort((a, b) => {
    const score = (voice) => Number(/natural|neural/i.test(voice.name)) * 12 + Number(/google/i.test(voice.name)) * 8 + Number(/microsoft/i.test(voice.name)) * 3 + Number(/^en-US$/i.test(voice.lang)) * 2 + Number(voice.default) * 0.1;
    return score(b) - score(a) || a.name.localeCompare(b.name);
  });
}
function renderVoiceOptions() {
  const select = $("shadow-voice");
  const voices = englishVoices();
  select.replaceChildren();
  if (!voices.length) {
    const option = node("option", "", "Không tìm thấy giọng tiếng Anh");
    option.value = "";
    select.append(option);
    select.disabled = true;
    $("shadow-voice-status").textContent = "Trình duyệt chưa có giọng tiếng Anh. Hãy cài thêm giọng English trong hệ điều hành hoặc thử trình duyệt khác.";
    return;
  }
  select.disabled = false;
  for (const voice of voices) {
    const option = node("option", "", `${voice.name} · ${voice.lang}`);
    option.value = voiceKey(voice);
    select.append(option);
  }
  select.value = voices.some((voice) => voiceKey(voice) === state.voiceKey) ? state.voiceKey : voiceKey(voices[0]);
  $("shadow-voice-status").textContent = `Đọc cả đoạn bằng ${select.selectedOptions[0]?.textContent || "giọng tiếng Anh"}.`;
}
let activeSpeech = null;
let activeSpeechButton = null;
function stopSpeech() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (activeSpeechButton) activeSpeechButton.textContent = "♪ Nghe mẫu";
  activeSpeech = null;
  activeSpeechButton = null;
}
function say(text, rate = 1, language = "en-US", button = null, preferredVoiceKey = "") {
  if (!window.speechSynthesis) { showToast("Trình duyệt này chưa có giọng đọc."); return; }
  if (button && activeSpeechButton === button) { stopSpeech(); return; }
  stopSpeech();
  const voices = englishVoices();
  if (!voices.length) { showToast("Chưa có giọng tiếng Anh. Hãy cài thêm giọng English hoặc thử trình duyệt khác."); return; }
  const speech = new SpeechSynthesisUtterance(text);
  const voice = voices.find((item) => voiceKey(item) === preferredVoiceKey) || voices.find((item) => item.lang.toLowerCase() === language.toLowerCase()) || voices[0];
  speech.voice = voice || null;
  speech.lang = voice?.lang || language;
  speech.rate = rate;
  activeSpeech = speech;
  activeSpeechButton = button;
  if (button) button.textContent = "■ Dừng đọc";
  speech.onend = () => { if (activeSpeech === speech) stopSpeech(); };
  speech.onerror = (event) => {
    if (activeSpeech !== speech) return;
    stopSpeech();
    if (event.error !== "interrupted" && event.error !== "canceled") showToast("Không đọc được bằng giọng này. Hãy thử chọn giọng khác.");
  };
  speechSynthesis.speak(speech);
}
function switchView(view) {
  if (!["vocabulary", "shadowing", "dictation", "translation"].includes(view)) return;
  stopSpeech();
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
    const entry = node("div", "word-entry");
    const button = node("button", "word-row");
    button.type = "button";
    button.dataset.word = card.word;
    const copy = node("span");
    copy.append(node("strong", "", card.word), node("small", "word-ipa", cardIpa(card) || "Chưa có IPA"), node("small", "", compactMeaning(card.meaning)), node("small", "word-definition", cardDefinitions(card).join(" · ") || "Thêm định nghĩa tiếng Anh"));
    const status = state.reviews[cardKey(card)] ? "Đang ôn" : card.pos || "Xem";
    button.append(copy, node("em", "", status));
    entry.append(button, speakerButton(card.word));
    list.append(entry);
  }
}
function updateVocabulary() { renderOverview(); renderWordResults(); }
function selectReviewCards() {
  const now = Date.now();
  const cards = levelCards();
  const due = cards.filter((card) => state.reviews[cardKey(card)]?.due <= now).sort((a, b) => state.reviews[cardKey(a)].due - state.reviews[cardKey(b)].due);
  const fresh = cards.filter((card) => !state.reviews[cardKey(card)]);
  return [...due.slice(0, 10), ...pickNewCards(fresh, Math.max(0, 10 - due.length))];
}
function startReview() {
  const cards = selectReviewCards();
  if (!cards.length) { showToast("Chưa có từ đến hạn. Hãy tìm và thêm một từ ở kho bên phải."); return; }
  state.session = { cards, tasks: buildReviewQueue(cards), cursor: 0, answered: false, wrongWords: new Set(), completed: 0, errors: 0 };
  $("review-overview").hidden = true;
  $("review-finished").hidden = true;
  $("review-session").hidden = false;
  renderQuestion();
}
function currentTask() { return state.session?.tasks[state.session.cursor]; }
function currentCard() { const task = currentTask(); return task ? state.session.cards[task.cardIndex] : null; }
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
  const task = currentTask();
  const card = currentCard();
  if (!session || !task || !card) return;
  const stage = task.stage;
  session.answered = false;
  $("session-position").textContent = `${session.cursor + 1} / ${session.tasks.length}`;
  $("session-stage").textContent = `${card.level} · ${{ meaning: "Chọn nghĩa", listening: "Nghe từ", spelling: "Viết từ", pronunciation: "Phát âm" }[stage]}`;
  $("session-meter-fill").style.width = `${(session.cursor / session.tasks.length) * 100}%`;
  $("choice-options").hidden = !["meaning", "listening"].includes(stage);
  $("spelling-form").hidden = stage !== "spelling";
  $("pronunciation-tools").hidden = stage !== "pronunciation";
  $("question-speak").hidden = stage !== "listening";
  $("question-word-speak").hidden = !["meaning", "pronunciation"].includes(stage);
  $("question-word-speak").setAttribute("aria-label", `Nghe phát âm ${card.word}`);
  $("question-ipa").hidden = !["meaning", "pronunciation"].includes(stage);
  $("question-ipa").textContent = cardIpa(card) || "Chưa có IPA";
  const definitions = cardDefinitions(card);
  const definitionBox = $("question-definitions");
  definitionBox.hidden = stage === "listening" || !definitions.length;
  const definitionList = $("question-definitions-list");
  definitionList.replaceChildren(...definitions.map((value) => node("li", "", value)));
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
  const stage = currentTask().stage;
  const correctAnswer = stage === "meaning" ? compactMeaning(card.meaning) : card.word;
  const correct = normalizeWord(answer) === normalizeWord(correctAnswer);
  session.answered = true;
  if (!correct) { session.wrongWords.add(cardKey(card)); session.errors++; }
  const feedback = $("answer-feedback");
  feedback.hidden = false;
  feedback.classList.toggle("incorrect", !correct);
  const message = correct ? `Đúng rồi. ${card.word} — ${card.meaning}` : `Chưa đúng. Đáp án: ${correctAnswer}. ${card.word} — ${card.meaning}`;
  feedback.replaceChildren(node("span", "", message));
  if (cardIpa(card)) feedback.append(node("span", "feedback-ipa", `IPA: ${cardIpa(card)}`));
  const definitions = cardDefinitions(card);
  if (definitions.length) feedback.append(node("span", "feedback-definition", `English: ${definitions.join(" · ")}`));
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
  state.session.cursor++;
  renderQuestion();
}
function completeCard(rating) {
  const session = state.session;
  if (!session) return;
  const card = currentCard();
  const key = cardKey(card);
  const finalRating = session.wrongWords.has(key) ? "again" : rating;
  state.reviews[key] = nextReview(state.reviews[key], finalRating);
  saveStore(KEYS.reviews, state.reviews);
  session.completed++;
  session.cursor++;
  updateVocabulary();
  if (session.cursor >= session.tasks.length) {
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
  $("dialog-ipa").value = cardIpa(card);
  $("dialog-english").value = cardDefinitions(card).join("\n");
  $("dialog-meaning").value = card.meaning;
  $("word-dialog").showModal();
}
function saveWordDialog() {
  const card = findCard(state.selectedWord);
  const meaning = $("dialog-meaning").value.trim();
  const ipa = $("dialog-ipa").value.trim();
  const definitions = $("dialog-english").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!card || !meaning) { showToast("Hãy nhập nghĩa tiếng Việt."); return; }
  if (!definitions.length || definitions.length > 2) { showToast("Hãy nhập một hoặc hai nghĩa / câu định nghĩa tiếng Anh."); return; }
  state.meanings[cardKey(card)] = meaning;
  state.ipa[cardKey(card)] = ipa;
  state.definitions[cardKey(card)] = definitions;
  saveStore(KEYS.meanings, state.meanings);
  saveStore(KEYS.ipa, state.ipa);
  saveStore(KEYS.definitions, state.definitions);
  const previous = state.reviews[cardKey(card)];
  state.reviews[cardKey(card)] = { ...(previous || {}), due: Date.now() - 1 };
  saveStore(KEYS.reviews, state.reviews);
  $("word-dialog").close();
  updateVocabulary();
  showToast(`Đã đưa “${card.word}” vào lượt ôn.`);
}
function addCustomWord(word, meaning, level = state.level, source = "custom", definitions = [], ipa = "") {
  const cleanWord = normalizeWord(word);
  if (!/^[a-z][a-z'-]{0,35}$/i.test(cleanWord) || !meaning.trim()) return false;
  const cleanDefinitions = definitions.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2);
  const existing = findCard(cleanWord);
  if (existing) state.meanings[cleanWord] = meaning.trim();
  else state.custom.push({ word: cleanWord, meaning: meaning.trim(), ipa: ipa.trim(), level: LEVELS.includes(level) ? level : "B2", pos: "word", definition: cleanDefinitions[0] || "", definitions: cleanDefinitions, source });
  if (cleanDefinitions.length) state.definitions[cleanWord] = cleanDefinitions;
  if (ipa.trim()) state.ipa[cleanWord] = ipa.trim();
  saveStore(KEYS.custom, state.custom);
  saveStore(KEYS.meanings, state.meanings);
  if (cleanDefinitions.length) saveStore(KEYS.definitions, state.definitions);
  if (ipa.trim()) saveStore(KEYS.ipa, state.ipa);
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
    if (blob && currentCard()?.word === word && currentTask()?.stage === "pronunciation") {
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

function storyById(id) { return state.customArticles[id] || state.news.find((story) => story.id === id); }
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
  const custom = Object.values(state.customArticles).filter((item) => item.language === language);
  if (custom.length) {
    const group = node("optgroup");
    group.label = "Link và văn bản của bạn";
    for (const article of [...custom].reverse()) {
      const option = node("option", "", article.title);
      option.value = article.id;
      group.append(option);
    }
    select.prepend(group);
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
  if (story.url) target.append(node("span", "", story.fullText ? " · Toàn bài tải online" : " · Tiêu đề và tóm tắt RSS"));
}
function useCustomArticle(mode, language, textareaId) {
  const text = $(textareaId).value.replace(/\s+/g, " ").trim();
  if (text.length < 30) { showToast("Hãy dán ít nhất 30 ký tự để bắt đầu."); return; }
  const article = { id: `custom-${mode}-${Date.now()}`, title: text.slice(0, 58) + (text.length > 58 ? "…" : ""), text, language, source: "Văn bản của bạn", url: null, date: null };
  cancelOnlineRequest(mode);
  if (mode === "shadowing") stopSpeech();
  state.customArticles[article.id] = article;
  if (mode === "shadowing") { state.shadowArticle = article; state.shadowIndex = 0; renderShadowing(true); }
  else if (mode === "dictation") { state.dictationArticle = article; state.dictationIndex = 0; renderDictation(true); }
  else { state.translationArticle = article; renderTranslation(true); }
  showToast("Đã tạo bài luyện từ văn bản bạn dán.");
}
function onlinePrefix(mode) { return mode === "shadowing" ? "shadow" : mode; }
function modeLanguage(mode) { return mode === "translation" && state.translationDirection === "vi-en" ? "vi" : "en"; }
function modeArticle(mode) { return mode === "shadowing" ? state.shadowArticle : mode === "dictation" ? state.dictationArticle : state.translationArticle; }
function setOnlineStatus(mode, message, busy = false) {
  const prefix = onlinePrefix(mode);
  const panel = $(`${prefix}-online`);
  panel.setAttribute("aria-busy", String(busy));
  panel.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  if (!busy) $(`${prefix}-fetch-current`).disabled = !modeArticle(mode)?.url || Boolean(modeArticle(mode)?.fullText);
  $(`${prefix}-online-status`).textContent = message;
}
function cancelOnlineRequest(mode) {
  state.onlineControllers[mode]?.abort();
  delete state.onlineControllers[mode];
  setOnlineStatus(mode, "", false);
}
function updateOnlineForArticle(mode, article) {
  if (state.onlineControllers[mode]) return;
  setOnlineStatus(mode, article?.fullText ? "Đang dùng toàn bài đã tải online." : article?.url ? "Đang dùng tiêu đề và tóm tắt RSS. Bấm “Tải toàn bài đã chọn” để đọc thêm." : "Đang dùng văn bản bạn dán.");
}
function articleUrlKey(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|at_medium$|at_campaign$)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function resolveOnlineCandidate(value, language) {
  if (typeof value !== "string") {
    if (!value?.url) throw new Error("Bài này không có link. Hãy dán một link báo hoặc dùng văn bản của bạn.");
    return value;
  }
  const url = normalizeArticleUrl(value);
  const known = state.news.find((article) => article.language === language && articleUrlKey(article.url) === articleUrlKey(url));
  if (known) return known;
  const existing = Object.values(state.customArticles).find((article) => article.language === language && article.url && articleUrlKey(article.url) === articleUrlKey(url));
  if (existing) return existing;
  return { id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, language, source: articleSource(url), title: "", date: null };
}
async function readOnlineArticle(url, signal) {
  let lastError = new Error("Không tìm thấy phần nội dung chính trong bài này.");
  for (const selector of articleSelectors(url)) {
    const combinedSignal = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : signal;
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "application/json", "X-Target-Selector": selector, "X-Respond-With": "text" },
      signal: combinedSignal,
    });
    if (!response.ok) {
      if (response.status === 422) { lastError = new Error("Không tìm thấy vùng bài viết ở nguồn này."); continue; }
      if (response.status === 429) throw new Error("Dịch vụ đọc bài đang giới hạn lượt tải. Hãy thử lại sau ít phút.");
      throw new Error(`Nguồn bài báo không trả nội dung (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    const data = payload.data || payload;
    const body = cleanArticleText(data.text || data.content);
    if (tokenizeWords(body).length < 35) { lastError = new Error("Bài này không có đủ văn bản để luyện tập."); continue; }
    return { title: String(data.title || "").trim(), body, date: data.publishedTime || null };
  }
  throw lastError;
}
function activateOnlineArticle(mode, article) {
  if (mode === "shadowing") {
    stopSpeech();
    if (state.recordPending || state.recorder?.state === "recording") stopRecording();
    state.shadowArticle = article;
    state.shadowIndex = 0;
    renderShadowing(true);
  } else if (mode === "dictation") {
    storeDictationAnswer();
    state.dictationArticle = article;
    state.dictationIndex = 0;
    renderDictation(true);
  } else {
    saveTranslationDraft();
    state.translationArticle = article;
    renderTranslation(true);
  }
}
async function loadOnlineArticle(mode, input, random = false) {
  cancelOnlineRequest(mode);
  const language = modeLanguage(mode);
  let candidates;
  try {
    candidates = random
      ? shuffle(state.news.filter((article) => article.language === language && article.url && articleUrlKey(article.url) !== articleUrlKey(modeArticle(mode)?.url || "https://example.invalid/"))).slice(0, 4)
      : [resolveOnlineCandidate(input, language)];
    if (!candidates.length) throw new Error("Chưa có bài báo để chọn ngẫu nhiên.");
  } catch (error) { setOnlineStatus(mode, error.message); return; }
  const controller = new AbortController();
  state.onlineControllers[mode] = controller;
  let status = "";
  setOnlineStatus(mode, random ? "Đang chọn và tải một bài báo mới…" : "Đang tải toàn bài từ link gốc…", true);
  try {
    let lastError;
    for (let index = 0; index < candidates.length; index++) {
      if (controller.signal.aborted) return;
      const candidate = candidates[index];
      if (random && index) setOnlineStatus(mode, `Bài trước chưa đọc được; đang thử bài ${index + 1}/${candidates.length}…`, true);
      try {
        const key = articleUrlKey(candidate.url);
        let article = state.onlineArticles.get(key);
        if (!article || article.language !== language) {
          const result = await readOnlineArticle(candidate.url, controller.signal);
          const title = candidate.title || result.title || articleSource(candidate.url);
          article = { ...candidate, id: `online-${candidate.id}`, title, text: `${title}\n\n${result.body}`, source: candidate.source || articleSource(candidate.url), language, date: candidate.date || result.date, fullText: true };
          state.onlineArticles.set(key, article);
          state.customArticles[article.id] = article;
        }
        if (controller.signal.aborted) return;
        activateOnlineArticle(mode, article);
        status = `Đã tải toàn bài: ${article.title} (${tokenizeWords(article.text).length} từ).`;
        return;
      } catch (error) {
        if (controller.signal.aborted) return;
        lastError = error;
        if (!random || /giới hạn lượt tải/.test(error.message)) break;
      }
    }
    throw lastError || new Error("Không tải được bài báo.");
  } catch (error) {
    if (!controller.signal.aborted) {
      const detail = error.name === "TimeoutError" || error.name === "AbortError"
        ? "Tải bài quá lâu."
        : error instanceof TypeError ? "Không kết nối được với dịch vụ đọc bài." : error.message;
      status = `${detail} Bạn có thể mở bài gốc và dán văn bản để học.`;
    }
  } finally {
    if (state.onlineControllers[mode] === controller) {
      delete state.onlineControllers[mode];
      setOnlineStatus(mode, status, false);
    }
  }
}
function articleSegments(article) { return splitSegments(article?.text || ""); }
function shadowArticleSegments(article) { return shadowSegments(article?.text || ""); }
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
  const segments = shadowArticleSegments(article);
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
  updateOnlineForArticle("shadowing", article);
}
function setShadowIndex(index) {
  stopSpeech();
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
  updateOnlineForArticle("dictation", article);
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
    const definition = node("input");
    definition.type = "text";
    definition.className = "unknown-definition";
    definition.value = cardDefinitions(card || {}).join(" · ");
    definition.placeholder = "Định nghĩa tiếng Anh";
    definition.setAttribute("aria-label", `Định nghĩa tiếng Anh của ${word}`);
    body.append(meaning, definition);
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
  const missingDefinition = selected.find((row) => !row.querySelector(".unknown-definition").value.trim());
  if (missingDefinition) { missingDefinition.querySelector(".unknown-definition").focus(); $("save-unknown-status").textContent = "Nhập định nghĩa tiếng Anh cho các từ đã chọn."; return; }
  let saved = 0;
  for (const row of selected) {
    const word = row.querySelector("input[type=checkbox]").value;
    const meaning = row.querySelector("input[type=text]").value;
    const definitions = row.querySelector(".unknown-definition").value.split(/\s*·\s*|\s*;\s*/).map((value) => value.trim()).filter(Boolean).slice(0, 2);
    const existing = findCard(word);
    if (addCustomWord(word, meaning, existing?.level || state.level, "dictation", definitions)) saved++;
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
  updateOnlineForArticle("translation", article);
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
$("question-word-speak").addEventListener("click", () => { const card = currentCard(); if (card) say(card.word, 0.9); });
$("vocab-record").addEventListener("click", () => { const card = currentCard(); if (card) toggleRecording("vocabulary", card.word); });
document.querySelector(".rating-row").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (button) { if (state.recordPending || state.recorder?.state === "recording") stopRecording(); completeCard(button.dataset.rating); }
});
$("word-search").addEventListener("input", renderWordResults);
$("word-results").addEventListener("click", (event) => {
  const speaker = event.target.closest("[data-speak-word]");
  if (speaker) { say(speaker.dataset.speakWord, 0.9); return; }
  const button = event.target.closest("[data-word]");
  if (button) openWord(button.dataset.word);
});
$("dialog-speak").addEventListener("click", () => { if (state.selectedWord) say(state.selectedWord, 0.9); });
$("dialog-save").addEventListener("click", saveWordDialog);
$("add-word-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const word = $("custom-word").value, meaning = $("custom-meaning").value;
  const definitions = $("custom-definition").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!definitions.length || definitions.length > 2) { showToast("Hãy nhập một hoặc hai định nghĩa tiếng Anh."); return; }
  if (!addCustomWord(word, meaning, $("custom-level").value, "custom", definitions, $("custom-ipa").value)) { showToast("Chỉ nhập một từ tiếng Anh và một nghĩa tiếng Việt."); return; }
  $("add-word-form").reset();
  $("custom-level").value = state.level;
  updateVocabulary();
  showToast(`Đã thêm “${normalizeWord(word)}” vào lịch ôn.`);
});

$("shadow-article").addEventListener("change", () => {
  stopSpeech();
  cancelOnlineRequest("shadowing");
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
  const text = shadowArticleSegments(state.shadowArticle)[state.shadowIndex];
  if (text) say(text, Number($("shadow-speed").value), "en-US", $("shadow-speak"), $("shadow-voice").value);
});
$("shadow-voice").addEventListener("change", () => {
  stopSpeech();
  state.voiceKey = $("shadow-voice").value;
  localStorage.setItem(KEYS.voice, state.voiceKey);
  renderVoiceOptions();
});
$("shadow-record").addEventListener("click", () => { if (state.shadowArticle) toggleRecording("shadowing", shadowKey(state.shadowArticle, state.shadowIndex)); });

$("dictation-article").addEventListener("change", () => {
  cancelOnlineRequest("dictation");
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
  cancelOnlineRequest("translation");
  saveTranslationDraft();
  state.translationDirection = button.dataset.direction;
  state.translationArticle = null;
  renderTranslation(true);
});
$("translation-article").addEventListener("change", () => {
  cancelOnlineRequest("translation");
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
for (const mode of ["shadowing", "dictation", "translation"]) {
  const prefix = onlinePrefix(mode);
  $(`${prefix}-fetch-current`).addEventListener("click", () => loadOnlineArticle(mode, modeArticle(mode)));
  $(`${prefix}-random`).addEventListener("click", () => loadOnlineArticle(mode, null, true));
  $(`${prefix}-link-form`).addEventListener("submit", (event) => { event.preventDefault(); loadOnlineArticle(mode, $(`${prefix}-link`).value); });
}
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
    renderVoiceOptions();
    if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", renderVoiceOptions);
    const responses = await Promise.all(DATA_URLS.map((url) => fetch(url)));
    if (responses.some((response) => !response.ok)) throw new Error("Không tải được dữ liệu học. Hãy tải lại trang.");
    const [vocabulary, news] = await Promise.all(responses.map((response) => response.json()));
    state.vocabulary = Array.isArray(vocabulary.cards) ? vocabulary.cards : [];
    state.news = Array.isArray(news.items) ? news.items : [];
    if (!state.vocabulary.length || !state.news.length) throw new Error("Dữ liệu học đang trống.");
    if (!LEVELS.includes(state.level)) state.level = "B2";
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
