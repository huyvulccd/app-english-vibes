import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const vocabulary = JSON.parse(await readFile(path.join(root, "vocabulary-data.json"), "utf8"));
const news = JSON.parse(await readFile(path.join(root, "news-data.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = process.env.PRACTICE_ORIGIN ? null : createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    const content = await readFile(target);
    response.writeHead(200, { "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream" });
    response.end(content);
  } catch { response.writeHead(404); response.end("Not found"); }
});
if (server) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = process.env.PRACTICE_ORIGIN?.replace(/\/$/, "") || `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "sayback-practice-chrome-"));
const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const errors = [];
let socket;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(callback, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await callback();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${errors.join(" | ")}`);
}
try {
  const port = await waitUntil(async () => { try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; } });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url: `${origin}/index.html` });
  await waitUntil(() => evaluate(`document.querySelector('#vocab-total')?.textContent === '${vocabulary.cards.length.toLocaleString("vi-VN")}' && document.querySelector('#shadow-article')?.options.length > 20`));
  const initial = await evaluate("({ count: document.querySelector('#vocab-total').textContent, news: document.querySelector('#shadow-article').options.length, levels: document.querySelectorAll('.level-switch button').length, voices: document.querySelector('#shadow-voice').options.length })");
  if (initial.levels !== 4 || initial.news !== news.items.filter((item) => item.language === "en").length) throw new Error(`Data mismatch: ${JSON.stringify(initial)}`);

  const chosen = vocabulary.cards.find((item) => item.word === "abolish");
  if (!chosen || chosen.level !== "B2") throw new Error("Missing B2 test word");
  const meaningOverride = "bãi bỏ kiểm thử";
  const ipaOverride = "/əˈbɒlɪʃ/";
  const englishOverride = "to officially end a law or system\nto put an end to an established practice";
  await evaluate(`(() => { const search = document.querySelector('#word-search'); search.value = ${JSON.stringify(chosen.word)}; search.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-word="${chosen.word}"]').click(); })()`);
  if (!(await evaluate(`document.querySelector('#dialog-ipa').value === ${JSON.stringify(chosen.ipa)} && !!document.querySelector('[data-speak-word="${chosen.word}"]')`))) throw new Error("Vocabulary IPA or speaker is missing");
  await evaluate(`(() => { document.querySelector('#dialog-meaning').value = ${JSON.stringify(meaningOverride)}; document.querySelector('#dialog-ipa').value = ${JSON.stringify(ipaOverride)}; document.querySelector('#dialog-english').value = ${JSON.stringify(englishOverride)}; document.querySelector('#dialog-save').click(); document.querySelector('#start-review').click(); })()`);
  await waitUntil(() => evaluate("document.querySelector('#session-position')?.textContent.includes('/ 40')"));
  const meaningWords = [];
  let recordedChosen = false;
  for (let question = 0; question < 40; question++) {
    const state = await evaluate("({ position: document.querySelector('#session-position').textContent, stage: document.querySelector('#session-stage').textContent, title: document.querySelector('#question-title').textContent, ipa: document.querySelector('#question-ipa').textContent, ipaVisible: !document.querySelector('#question-ipa').hidden, speakerVisible: !document.querySelector('#question-word-speak').hidden, definitionVisible: !document.querySelector('#question-definitions').hidden, definitionCount: document.querySelectorAll('#question-definitions-list li').length })");
    if (Number(state.position.split(" /")[0]) !== question + 1) throw new Error(`Question order failed: ${JSON.stringify(state)}`);
    if (state.stage.includes("Chọn nghĩa")) {
      meaningWords.push(state.title);
      if (!state.definitionVisible || !state.definitionCount || state.definitionCount > 2) throw new Error(`Missing English definitions: ${JSON.stringify(state)}`);
      if (!state.ipaVisible || !state.speakerVisible || state.ipa !== (state.title === chosen.word ? ipaOverride : vocabulary.cards.find((card) => card.word === state.title)?.ipa || "Chưa có IPA")) throw new Error(`Missing vocabulary pronunciation: ${JSON.stringify(state)}`);
      await evaluate(`(() => { const buttons = [...document.querySelectorAll('#choice-options button')]; (buttons.find((button) => button.textContent === ${JSON.stringify(state.title === chosen.word ? meaningOverride : "__none__")}) || buttons[0]).click(); document.querySelector('#next-question').click(); })()`);
    } else if (state.stage.includes("Nghe từ")) {
      if (state.definitionVisible || state.speakerVisible || state.ipaVisible) throw new Error("Listening question revealed the answer before playback");
      await evaluate("document.querySelector('#choice-options button').click(); document.querySelector('#next-question').click()");
    } else if (state.stage.includes("Viết từ")) {
      await evaluate(`(() => { document.querySelector('#spelling-input').value = ${JSON.stringify(state.title === meaningOverride ? chosen.word : "test")}; document.querySelector('#spelling-form').requestSubmit(); document.querySelector('#next-question').click(); })()`);
    } else if (state.stage.includes("Phát âm")) {
      if (!state.ipaVisible || !state.speakerVisible) throw new Error(`Pronunciation controls missing: ${JSON.stringify(state)}`);
      if (state.title === chosen.word) {
        await evaluate("document.querySelector('#vocab-record').click()");
        await waitUntil(() => evaluate("document.querySelector('#vocab-record')?.textContent.includes('Dừng ghi')"));
        await delay(700);
        await evaluate("document.querySelector('#vocab-record').click()");
        try { await waitUntil(() => evaluate("document.querySelector('#vocab-recording')?.hidden === false")); }
        catch (error) { throw new Error(`${error.message}; recording=${JSON.stringify(await evaluate("({ status: document.querySelector('#vocab-record-status').textContent, button: document.querySelector('#vocab-record').textContent, playback: document.querySelector('#vocab-recording').outerHTML })"))}`); }
        recordedChosen = true;
      }
      await evaluate("document.querySelector('[data-rating=good]').click()");
    } else throw new Error(`Unexpected vocabulary stage: ${JSON.stringify(state)}`);
    if (question < 39) await waitUntil(() => evaluate(`document.querySelector('#session-position')?.textContent.startsWith('${question + 2} /')`));
  }
  if (!recordedChosen || new Set(meaningWords).size !== 10 || !(await evaluate("document.querySelector('#review-finished').hidden === false"))) throw new Error(`Incomplete mixed review: ${JSON.stringify({ recordedChosen, meaningWords })}`);
  for (const word of meaningWords.filter((word) => word !== chosen.word)) {
    const card = vocabulary.cards.find((item) => item.word === word);
    if (!card || card.tier < 2 || card.tier > 4 || card.word.length < 5) throw new Error(`Easy new word selected: ${word}`);
  }
  const review = await evaluate(`({ due: JSON.parse(localStorage.getItem('sayback-vocabulary-reviews-v1'))?.[${JSON.stringify(chosen.word)}]?.due, meaning: JSON.parse(localStorage.getItem('sayback-vocabulary-meanings-v1'))?.[${JSON.stringify(chosen.word)}], ipa: JSON.parse(localStorage.getItem('sayback-vocabulary-ipa-v1'))?.[${JSON.stringify(chosen.word)}], definitions: JSON.parse(localStorage.getItem('sayback-vocabulary-definitions-v1'))?.[${JSON.stringify(chosen.word)}] })`);
  if (!review.due || review.meaning !== meaningOverride || review.ipa !== ipaOverride || review.definitions?.length !== 2) throw new Error(`Vocabulary review not saved: ${JSON.stringify(review)}`);

  await evaluate("document.querySelector('[data-view=shadowing]').click()");
  await waitUntil(() => evaluate("document.querySelector('#shadow-text')?.textContent.length > 20"));
  const shadowSpeech = await evaluate("({ words: document.querySelector('#shadow-text').textContent.trim().split(/\\s+/).length, voice: document.querySelector('#shadow-voice').selectedOptions[0]?.textContent, options: document.querySelector('#shadow-voice').options.length })");
  if (shadowSpeech.words < 10 || !shadowSpeech.options) throw new Error(`Shadowing speech setup invalid: ${JSON.stringify(shadowSpeech)}`);
  const selectedVoice = await evaluate("(() => { const select = document.querySelector('#shadow-voice'); if (select.options.length > 1) { select.selectedIndex = 1; select.dispatchEvent(new Event('change')); } return select.value; })()");
  const utterance = await evaluate("(() => { const synth = window.speechSynthesis; const original = synth.speak; synth.speak = (speech) => { window.lastShadowUtterance = { text: speech.text, rate: speech.rate, voiceKey: speech.voice?.voiceURI || speech.voice?.name }; }; document.querySelector('#shadow-speak').click(); synth.speak = original; document.querySelector('#shadow-speak').click(); return window.lastShadowUtterance; })()");
  if (!utterance || utterance.text !== await evaluate("document.querySelector('#shadow-text').textContent") || utterance.rate !== 1 || (selectedVoice && utterance.voiceKey !== selectedVoice)) throw new Error(`Shadowing did not speak one full passage with the selected voice: ${JSON.stringify(utterance)}`);
  await evaluate("document.querySelector('#shadow-record').click()");
  await waitUntil(() => evaluate("document.querySelector('#shadow-record')?.getAttribute('aria-label') === 'Dừng ghi âm'"));
  await delay(700);
  await evaluate("document.querySelector('#shadow-record').click()");
  await waitUntil(() => evaluate("document.querySelector('#shadow-playback')?.hidden === false"));
  await evaluate("document.querySelector('#shadow-next').click(); document.querySelector('#shadow-prev').click()");
  if (!(await evaluate("document.querySelector('#shadow-playback').hidden === false"))) throw new Error("Shadowing recording disappeared after changing segments");

  await evaluate("document.querySelector('[data-view=dictation]').click()");
  await evaluate("(() => { const field = document.querySelector('#dictation-answer'); field.value = 'An incomplete answer'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#dictation-next').click(); })()");
  await evaluate("(() => { const field = document.querySelector('#dictation-answer'); field.value = 'Another answer'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#dictation-prev').click(); })()");
  if (!(await evaluate("document.querySelector('#dictation-answer').value === 'An incomplete answer'"))) throw new Error("Dictation draft disappeared after changing segments");
  await evaluate("document.querySelector('#dictation-finish').click()");
  const dictation = await evaluate("({ score: document.querySelector('#dictation-accuracy').textContent, errors: document.querySelectorAll('.word-error').length, words: document.querySelectorAll('.unknown-row').length })");
  if (dictation.score === "100%" || !dictation.errors || !dictation.words) throw new Error(`Dictation result invalid: ${JSON.stringify(dictation)}`);
  await evaluate("(() => { const row = document.querySelector('.unknown-row'); row.querySelector('input[type=checkbox]').checked = true; row.querySelector('input[type=text]').value = 'nghĩa kiểm thử'; row.querySelector('.unknown-definition').value = 'an English meaning for this word'; document.querySelector('#save-unknown').click(); })()");
  if (!(await evaluate("document.querySelector('#save-unknown-status').textContent.includes('Đã lưu 1 từ')"))) throw new Error("Unknown word was not saved");
  const savedUnknownWord = await evaluate("document.querySelector('.unknown-row input[type=checkbox]').value");

  await evaluate("document.querySelector('[data-view=translation]').click()");
  await evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.copiedPrompt = value; } } })");
  await evaluate("(() => { const field = document.querySelector('#translation-answer'); field.value = 'Bản dịch kiểm thử'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#translation-copy').click(); })()");
  await waitUntil(() => evaluate("window.copiedPrompt?.includes('EN:') && window.copiedPrompt?.includes('VI: Bản dịch kiểm thử')"));
  await evaluate("document.querySelector('[data-direction=vi-en]').click()");
  await evaluate("(() => { const field = document.querySelector('#translation-answer'); field.value = 'English test translation'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#translation-copy').click(); })()");
  await waitUntil(() => evaluate("window.copiedPrompt?.includes('EN: English test translation') && window.copiedPrompt?.includes('OUTPUT cần là')"));

  await send("Page.reload", { ignoreCache: true });
  await waitUntil(() => evaluate("performance.getEntriesByType('navigation')[0]?.type === 'reload' && document.readyState === 'complete' && document.querySelector('#vocab-total')?.textContent.length > 2"));
  const persisted = await evaluate(`(async () => {
    const reviews = JSON.parse(localStorage.getItem('sayback-vocabulary-reviews-v1') || '{}');
    const meanings = JSON.parse(localStorage.getItem('sayback-vocabulary-meanings-v1') || '{}');
    const ipa = JSON.parse(localStorage.getItem('sayback-vocabulary-ipa-v1') || '{}');
    const definitions = JSON.parse(localStorage.getItem('sayback-vocabulary-definitions-v1') || '{}');
    const request = indexedDB.open('sayback-practice-recordings-v1');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('vocabulary', 'readonly');
    const recording = await new Promise((resolve, reject) => { const item = transaction.objectStore('vocabulary').get(${JSON.stringify(chosen.word)}); item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
    return { chosenDue: reviews[${JSON.stringify(chosen.word)}]?.due, unknownDue: reviews[${JSON.stringify(savedUnknownWord)}]?.due, unknownDefinition: definitions[${JSON.stringify(savedUnknownWord)}]?.[0], meaning: meanings[${JSON.stringify(chosen.word)}], ipa: ipa[${JSON.stringify(chosen.word)}], definitions: definitions[${JSON.stringify(chosen.word)}], voiceKey: localStorage.getItem('sayback-english-voice-v1'), recordingSize: recording?.size || 0, shadowCount: document.querySelector('#shadow-record-count').textContent };
  })()`);
  if (!persisted.chosenDue || !persisted.unknownDue || persisted.unknownDefinition !== "an English meaning for this word" || persisted.meaning !== meaningOverride || persisted.ipa !== ipaOverride || persisted.definitions?.length !== 2 || persisted.voiceKey !== selectedVoice || !persisted.recordingSize || persisted.shadowCount !== "0") throw new Error(`Persistence failed: ${JSON.stringify(persisted)}`);

  let online;
  if (process.env.PRACTICE_ONLINE === "1") {
    const waitForOnline = async (prefix) => {
      await waitUntil(() => evaluate(`(() => { const value = document.querySelector('#${prefix}-online-status')?.textContent || ''; return value.startsWith('Đã tải toàn bài:') || value.includes('Bạn có thể mở bài gốc'); })()`), 100000);
      const status = await evaluate(`document.querySelector('#${prefix}-online-status').textContent`);
      if (!status.startsWith("Đã tải toàn bài:")) throw new Error(`Online ${prefix}: ${status}`);
      return status;
    };
    const bbc = news.items.find((item) => item.source === "BBC News");
    const vietnamNews = news.items.find((item) => item.source === "Viet Nam News");
    const vnexpress = news.items.find((item) => item.source === "VnExpress");
    await evaluate(`(() => { document.querySelector('[data-view=shadowing]').click(); const select = document.querySelector('#shadow-article'); select.value = ${JSON.stringify(bbc.id)}; select.dispatchEvent(new Event('change')); document.querySelector('#shadow-fetch-current').click(); })()`);
    const shadowStatus = await waitForOnline("shadow");
    const shadowSegments = await evaluate("document.querySelectorAll('#shadow-segments button').length");
    if (shadowSegments < 4 || !(await evaluate("document.querySelector('#shadow-article-meta').textContent.includes('Toàn bài tải online')"))) throw new Error(`Online shadowing article missing: ${shadowSegments}`);
    const customBbcUrl = new URL(bbc.url);
    customBbcUrl.searchParams.set("sayback_probe", "1");
    await evaluate(`(() => { document.querySelector('#shadow-link').value = ${JSON.stringify(customBbcUrl.href)}; document.querySelector('#shadow-link-form').requestSubmit(); })()`);
    const pastedLinkStatus = await waitForOnline("shadow");
    if (!(await evaluate("document.querySelector('#shadow-article').value.startsWith('online-link-')"))) throw new Error("A pasted article URL was not added to the selector");
    await evaluate(`(() => { document.querySelector('[data-view=dictation]').click(); document.querySelector('#dictation-link').value = ${JSON.stringify(vietnamNews.url)}; document.querySelector('#dictation-link-form').requestSubmit(); })()`);
    const dictationStatus = await waitForOnline("dictation");
    const dictationSegments = await evaluate("document.querySelectorAll('#dictation-segments button').length");
    if (dictationSegments < 4) throw new Error(`Online dictation article missing: ${dictationSegments}`);
    await evaluate(`(() => { document.querySelector('[data-view=translation]').click(); document.querySelector('[data-direction=vi-en]').click(); document.querySelector('#translation-link').value = ${JSON.stringify(vnexpress.url)}; document.querySelector('#translation-link-form').requestSubmit(); })()`);
    const translationStatus = await waitForOnline("translation");
    const translationLength = await evaluate("document.querySelector('#translation-source').textContent.length");
    if (translationLength < 1000) throw new Error(`Online translation article too short: ${translationLength}`);
    await evaluate("document.querySelector('[data-view=shadowing]').click(); document.querySelector('#shadow-random').click()");
    const randomStatus = await waitForOnline("shadow");
    online = { shadowStatus, shadowSegments, pastedLinkStatus, dictationStatus, dictationSegments, translationStatus, translationLength, randomStatus };
  }

  if (process.env.PRACTICE_SCREENSHOTS === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.reload", { ignoreCache: true });
    await waitUntil(() => evaluate("document.querySelector('#vocab-total')?.textContent.length > 2"));
    const desktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-desktop.png"), Buffer.from(desktop.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobile = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-mobile.png"), Buffer.from(mobile.data, "base64"));
    await evaluate("document.querySelector('[data-view=vocabulary]').click(); document.querySelector('#start-review').click()");
    await waitUntil(() => evaluate("document.querySelector('#question-definitions')?.hidden === false"));
    const vocabMobile = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-vocab-mobile.png"), Buffer.from(vocabMobile.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const vocabDesktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-vocab-desktop.png"), Buffer.from(vocabDesktop.data, "base64"));
    await evaluate("document.querySelector('[data-view=shadowing]').click()");
    const shadowDesktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-shadow-desktop.png"), Buffer.from(shadowDesktop.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const shadowMobile = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(root, ".practice-shadow-mobile.png"), Buffer.from(shadowMobile.data, "base64"));
  }
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ initial, reviewSaved: true, shadowSpeech, shadowRecordingRetained: true, dictation, translationPrompts: true, persisted, online, browserErrors: errors.length }, null, 2));
} finally {
  socket?.close();
  browser.kill();
  await delay(500);
  const safeRoot = path.resolve(os.tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(safeRoot) && path.basename(profile).startsWith("sayback-practice-chrome-")) await rm(profile, { recursive: true, force: true }).catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
