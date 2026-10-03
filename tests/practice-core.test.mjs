import test from "node:test";
import assert from "node:assert/strict";
import { splitSegments, shadowSegments, compareWords, nextReview, translationPrompt, pickNewCards, buildReviewQueue, STAGES } from "../practice-core.mjs";

test("splits news passages at clauses while keeping numbers together", () => {
  assert.deepEqual(splitSegments("The figure rose to 10,000 people, according to the report. It may rise again!"), [
    "The figure rose to 10,000 people,", "according to the report.", "It may rise again!",
  ]);
});

test("shadowing joins short clauses into speakable passages", () => {
  const text = "The council met today, after several weeks of debate, and voted to reopen the library. Residents welcomed the decision, but asked for longer opening hours.\n\nThe museum will stay closed this month.";
  assert.deepEqual(shadowSegments(text), [
    "The council met today, after several weeks of debate, and voted to reopen the library.",
    "Residents welcomed the decision, but asked for longer opening hours.",
    "The museum will stay closed this month.",
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

test("new cards are sampled from the less familiar frequency tiers", () => {
  const cards = [
    { word: "able", tier: 1 }, { word: "above", tier: 1 },
    { word: "abolish", tier: 2 }, { word: "abruptly", tier: 3 }, { word: "abstain", tier: 4 },
  ];
  const picked = pickNewCards(cards, 3, () => 0.4);
  assert.deepEqual(new Set(picked.map((card) => card.word)), new Set(["abolish", "abruptly", "abstain"]));
});

test("review tasks revisit each word across mixed questions without adjacent repeats", () => {
  const cards = Array.from({ length: 10 }, (_, index) => ({ word: `word${index}` }));
  for (let seed = 1; seed <= 100; seed++) {
    let value = seed;
    const random = () => ((value = (value * 1664525 + 1013904223) >>> 0) / 4294967296);
    const tasks = buildReviewQueue(cards, random);
    assert.equal(tasks.length, cards.length * STAGES.length);
    assert.deepEqual(new Set(tasks.slice(0, cards.length).map((task) => task.stage)), new Set(["meaning"]));
    for (let index = 1; index < tasks.length; index++) assert.notEqual(tasks[index].cardIndex, tasks[index - 1].cardIndex);
    for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
      assert.deepEqual(tasks.filter((task) => task.cardIndex === cardIndex).map((task) => task.stage), STAGES);
    }
  }
});
