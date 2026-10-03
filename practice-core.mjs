export const LEVELS = ["B1", "B2", "C1", "C2"];
export const STAGES = ["meaning", "listening", "spelling", "pronunciation"];

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

export function pickNewCards(cards, count, random = Math.random) {
  const preferred = cards.filter((card) => Number(card.tier) >= 2 && Number(card.tier) <= 4 && card.word.length >= 5);
  const remaining = cards.filter((card) => !preferred.includes(card));
  return [...shuffled(preferred, random), ...shuffled(remaining, random)].slice(0, count);
}

export function buildReviewQueue(cards, random = Math.random) {
  if (!cards.length) return [];
  const indices = shuffled(cards.map((_, index) => index), random);
  const tasks = indices.map((cardIndex) => ({ cardIndex, stage: STAGES[0] }));
  const progress = cards.map(() => 1);
  const recent = indices.slice(-Math.min(4, cards.length - 1));
  while (progress.some((stage) => stage < STAGES.length)) {
    const active = indices.filter((index) => progress[index] < STAGES.length);
    const safe = active.filter((candidate) => {
      if (candidate === tasks.at(-1).cardIndex && active.length > 1) return false;
      const total = active.reduce((sum, index) => sum + STAGES.length - progress[index], 0) - 1;
      return active.every((index) => {
        const remaining = STAGES.length - progress[index] - Number(index === candidate);
        return remaining <= total - remaining + Number(index !== candidate);
      });
    });
    const spaced = safe.filter((index) => !recent.includes(index));
    const choices = spaced.length ? spaced : safe.length ? safe : active;
    const weights = choices.map((index) => 1 + (STAGES.length - progress[index]) * 3);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = random() * total;
    let picked = choices.at(-1);
    for (let index = 0; index < choices.length; index++) {
      target -= weights[index];
      if (target < 0) { picked = choices[index]; break; }
    }
    tasks.push({ cardIndex: picked, stage: STAGES[progress[picked]++] });
    recent.push(picked);
    if (recent.length > Math.min(4, cards.length - 1)) recent.shift();
  }
  return tasks;
}

export function splitSegments(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (!/[,.!?;:]/.test(char)) continue;
    const next = text[index + 1] || "";
    if (next && !/\s/.test(next)) continue;
    const candidate = text.slice(start, index + 1).trim();
    if (candidate.split(/\s+/).length < 3 && char !== ".") continue;
    if (candidate.length < 12) continue;
    parts.push(candidate);
    start = index + 1;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push(rest);
  return parts.length ? parts : [text];
}

export function shadowSegments(value) {
  const result = [];
  for (const paragraph of String(value || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    let current = "";
    let count = 0;
    for (const clause of splitSegments(paragraph)) {
      const clauseWords = tokenizeWords(clause).length;
      if (count >= 10 && count + clauseWords > 32) {
        result.push(current);
        current = "";
        count = 0;
      }
      current = current ? `${current} ${clause}` : clause;
      count += clauseWords;
      if (count >= 10 && (/[.!?]$/.test(clause) || count >= 32)) {
        result.push(current);
        current = "";
        count = 0;
      }
    }
    if (current) result.push(current);
  }
  return result;
}

export function tokenizeWords(value) {
  return String(value || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
}

export function normalizeWord(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en").replace(/[’‘]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function compareWords(reference, response) {
  const expected = tokenizeWords(reference);
  const actual = tokenizeWords(response);
  const rows = expected.length + 1, columns = actual.length + 1;
  const costs = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let i = 0; i < rows; i++) costs[i][0] = i;
  for (let j = 0; j < columns; j++) costs[0][j] = j;
  for (let i = 1; i < rows; i++) for (let j = 1; j < columns; j++) {
    const equal = normalizeWord(expected[i - 1]) === normalizeWord(actual[j - 1]);
    costs[i][j] = Math.min(costs[i - 1][j] + 1, costs[i][j - 1] + 1, costs[i - 1][j - 1] + (equal ? 0 : 1));
  }
  const operations = [];
  let i = expected.length, j = actual.length;
  while (i || j) {
    if (i && j && normalizeWord(expected[i - 1]) === normalizeWord(actual[j - 1]) && costs[i][j] === costs[i - 1][j - 1]) {
      operations.push({ kind: "correct", expected: expected[--i], actual: actual[--j] });
    } else if (i && j && costs[i][j] === costs[i - 1][j - 1] + 1) {
      operations.push({ kind: "substitute", expected: expected[--i], actual: actual[--j] });
    } else if (i && costs[i][j] === costs[i - 1][j] + 1) {
      operations.push({ kind: "missing", expected: expected[--i], actual: "" });
    } else {
      operations.push({ kind: "extra", expected: "", actual: actual[--j] });
    }
  }
  operations.reverse();
  const errors = costs[expected.length][actual.length];
  const accuracy = expected.length ? Math.max(0, Math.round((1 - errors / expected.length) * 100)) : 100;
  return { operations, errors, referenceWords: expected.length, accuracy };
}

export function nextReview(previous, rating, now = Date.now()) {
  const old = previous || {};
  const ease = Math.max(1.3, Math.min(3.5, Number(old.ease) || 2.4));
  const repetitions = Math.max(0, Number(old.repetitions) || 0);
  const day = 86_400_000;
  if (rating === "again") return { repetitions: 0, ease: Math.max(1.3, +(ease - 0.2).toFixed(2)), intervalDays: 0, due: now + 60_000, lastReviewed: now };
  const nextRepetitions = repetitions + 1;
  const intervalDays = rating === "easy"
    ? (repetitions === 0 ? 3 : Math.max(7, Math.round((Number(old.intervalDays) || 1) * ease * 1.3)))
    : (repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.max(4, Math.round((Number(old.intervalDays) || 3) * ease)));
  return { repetitions: nextRepetitions, ease: Math.min(3.5, +(ease + (rating === "easy" ? 0.15 : 0)).toFixed(2)), intervalDays, due: now + intervalDays * day, lastReviewed: now };
}

export function translationPrompt(direction, original, answer) {
  const source = String(original || "").trim();
  const translation = String(answer || "").trim();
  if (direction === "en-vi") return `Dưới đây là bài tập dịch của tôi, hãy chấm điểm tổng thể:\nEN: ${source}\nVI: ${translation}`;
  return `Dưới đây là bài tập dịch của tôi,\nVI: ${source}\nEN: ${translation}\nOUTPUT cần là hãy chấm điểm từ vựng, ngữ pháp, tổng thể, và đưa ra các loại từ vựng còn yếu, các ngữ pháp cần khắc phục, đoạn dịch sau khi chữa bài.`;
}
