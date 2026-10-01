import test from "node:test";
import assert from "node:assert/strict";
import { parseResearchText } from "../research-parser.mjs";

test("extracts reviewed fields from a Google AI style answer", () => {
  const copied = `Repository là danh từ chỉ một nơi cất giữ.
Phát âm (Pronunciation)
• Anh - Anh (UK): /rɪˈpɒz.ɪ.tər.i/
• Anh - Mỹ (US): /rɪˈpɑː.zɪ.tɔːr.i/
Ý nghĩa (Meaning)
• Kho chứa, nơi lưu trữ: Một địa điểm dùng để cất giữ đồ vật.
  ◦ Ví dụ: a repository for nuclear waste (kho chứa chất thải hạt nhân).
• Người hoặc sách chứa kiến thức: Nguồn cung cấp nhiều thông tin.
Họ từ (Word Family)
• repositories, repository`;
  const result = parseResearchText(copied, "word");
  assert.equal(result.values.partOfSpeech, "noun");
  assert.equal(result.values.ipa, "/rɪˈpɑː.zɪ.tɔːr.i/");
  assert.equal(result.ipaOptions.uk, "/rɪˈpɒz.ɪ.tər.i/");
  assert.match(result.values.meaning, /Kho chứa, nơi lưu trữ/);
  assert.match(result.values.meaning, /Người hoặc sách chứa kiến thức/);
  assert.equal(result.values.example, "a repository for nuclear waste");
  assert.equal(result.values.family, "repositories, repository");
});

test("parses labeled AI output and hides word fields for a sentence", () => {
  const copied = `**Loại từ:** verb
IPA: /aɪ æm ˈlɜːrnɪŋ ˈɪŋɡlɪʃ/
Nghĩa tiếng Việt: Tôi đang học tiếng Anh.
Word family: learning, learner
Ví dụ: I learn every day.`;
  const result = parseResearchText(copied, "sentence");
  assert.equal(result.values.ipa, "/aɪ æm ˈlɜːrnɪŋ ˈɪŋɡlɪʃ/");
  assert.equal(result.values.meaning, "Tôi đang học tiếng Anh.");
  assert.equal(result.values.partOfSpeech, "");
  assert.equal(result.values.family, "");
  assert.equal(result.values.example, "");
});

test("does not put English dictionary definitions into Vietnamese meaning", () => {
  const copied = `repository noun
UK /rɪˈpɒz.ɪ.tər.i/
Meaning: a place where things are stored`;
  const result = parseResearchText(copied, "word");
  assert.equal(result.values.partOfSpeech, "noun");
  assert.equal(result.values.ipa, "/rɪˈpɒz.ɪ.tər.i/");
  assert.equal(result.values.meaning, "");
});
