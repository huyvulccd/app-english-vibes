import test from "node:test";
import assert from "node:assert/strict";
import { describeCourseFile, matchesCourseSearch } from "../course-model.mjs";

test("catalog sorts book, audio, pronunciation and assessment files", () => {
  assert.equal(describeCourseFile("1.BEGINNER/New English File Beginner Student’s Book.pdf", 100).topic, "books");
  assert.equal(describeCourseFile("2.ELEMENTARY/CD1/Track 1.mp3", 100).topic, "listening");
  assert.equal(describeCourseFile("3.PRE-INTERMEDIATE/CDROM/data/flash/pronounce/audio/car.mp3", 100).topic, "pronunciation");
  assert.equal(describeCourseFile("4.INTERMEDIATE/CDROM/data/dictation/audio/unit01.mp3", 100).topic, "dictation");
  assert.equal(describeCourseFile("6.ADVANCED/NEF Advanced Test and Assessment CD-ROM/file_tests/file01.pdf", 100).topic, "tests");
});

test("search matches multiple terms across the relative path", () => {
  const entry = describeCourseFile("6.ADVANCED/NEF Advanced CD1/02 1.1.mp3.MP3", 100);
  assert.equal(entry.kind, "audio");
  assert.equal(matchesCourseSearch(entry, "advanced 1.1"), true);
  assert.equal(matchesCourseSearch(entry, "beginner 1.1"), false);
});
