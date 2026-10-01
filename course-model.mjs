const AUDIO_EXTENSIONS = new Set(["mp3", "wma", "ogg", "aif", "aiff", "wav"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt"]);

export function describeCourseFile(path, bytes) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();
  const kind = extension === "pdf" ? "pdf" : AUDIO_EXTENSIONS.has(extension) ? "audio" : DOCUMENT_EXTENSIONS.has(extension) ? "document" : "legacy";
  let topic = "legacy";
  if (/\b(test|assessment|exam|quicktest|progress.?test)\b/.test(lowerPath) || /test|assessment|exam/.test(lowerName)) {
    topic = "tests";
  } else if (/pronounc|pronounce|phonetic/.test(lowerPath)) {
    topic = "pronunciation";
  } else if (/vocab|wordsandphrases|word.?building/.test(lowerPath)) {
    topic = "vocabulary";
  } else if (/grammar/.test(lowerPath)) {
    topic = "grammar";
  } else if (/practical|speaking|dialogue/.test(lowerPath)) {
    topic = "communication";
  } else if (/dictation/.test(lowerPath)) {
    topic = "dictation";
  } else if (kind === "audio") {
    topic = "listening";
  } else if (kind === "pdf" || kind === "document") {
    topic = "books";
  }
  return { path, bytes, name, extension, kind, topic, level: path.split("/")[0] };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function matchesCourseSearch(entry, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = entry.path.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}
