import test from "node:test";
import assert from "node:assert/strict";
import { splitSegments, compareWords, nextReview, translationPrompt } from "../practice-core.mjs";

test("splits news passages at clauses while keeping numbers together", () => {
  assert.deepEqual(splitSegments("The figure rose to 10,000 people, according to the report. It may rise again!"), [
    "The figure rose to 10,000 people,", "according to the report.", "It may rise again!",
  ]);
});

test("dictation alignment marks substitutions, missing words and extra words", () => {
  const result = compareWords("The market grew quickly today", "The market grows very today");
  assert.equal(result.referenceWords, 5);
  assert.equal(result.accuracy, 60);
  assert.deepEqual(result.operations.filter((item) => item.kind !== "correct").map((item) => item.kind), ["substitute", "substitute"]);
  assert.equal(compareWords("a bright day", "a day").accuracy, 67);
  assert.equal(compareWords("a day", "a bright day").accuracy, 50);
});

test("spaced repetition schedules again, good and easy differently", () => {
  const now = Date.UTC(2026, 9, 2);
  assert.equal(nextReview(null, "again", now).due, now + 60_000);
  assert.equal(nextReview(null, "good", now).due, now + 86_400_000);
  assert.equal(nextReview(null, "easy", now).due, now + 3 * 86_400_000);
  assert.equal(nextReview(nextReview(null, "good", now), "good", now).intervalDays, 3);
});

test("translation prompts label both languages correctly", () => {
  assert.match(translationPrompt("en-vi", "Hello", "Xin chào"), /EN: Hello\nVI: Xin chào/);
  assert.match(translationPrompt("vi-en", "Xin chào", "Hello"), /VI: Xin chào\nEN: Hello/);
  assert.match(translationPrompt("vi-en", "Xin chào", "Hello"), /ngữ pháp, tổng thể/);
});
