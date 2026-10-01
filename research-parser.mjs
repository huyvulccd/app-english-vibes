const VIETNAMESE = /[À-ỹĐđ]/u;

function cleanLine(value) {
  return value
    .replace(/^\s*(?:[-*•◦▪‣]|\d+[.)])\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/【[^】]*】|\[[0-9]+\]/g, "")
    .trim();
}

function afterLabel(line, pattern) {
  const match = line.match(pattern);
  if (!match) return null;
  return (match[1] || "").trim();
}

function partOfSpeech(value) {
  const lower = value.toLocaleLowerCase();
  const names = [
    [/\bnoun\b/u, "danh từ", "noun"],
    [/\bverb\b/u, "động từ", "verb"],
    [/\badjective\b/u, "tính từ", "adjective"],
    [/\badverb\b/u, "trạng từ", "adverb"],
  ];
  return names
    .filter(
      ([pattern, vietnamese]) =>
        pattern.test(lower) || lower.includes(vietnamese),
    )
    .map(([, , name]) => name)
    .join(", ");
}

function ipaCandidates(text) {
  const matches = [...text.matchAll(/\/([^/\r\n]{2,120})\//g)];
  const options = { uk: "", us: "", other: "" };
  for (const match of matches) {
    const body = match[1].trim();
    if (!/[a-zɑ-ʯəɪʊˈˌ]/iu.test(body)) continue;
    const ipa = `/${body}/`;
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const context = text.slice(lineStart, match.index).toLocaleLowerCase();
    if (/\b(uk|british)\b|anh\s*[-–]\s*anh/u.test(context)) options.uk ||= ipa;
    else if (/\b(us|american)\b|anh\s*[-–]\s*mỹ/u.test(context))
      options.us ||= ipa;
    else options.other ||= ipa;
  }
  return options;
}

export function parseResearchText(input, type = "word") {
  const text = String(input || "").slice(0, 30000);
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const ipaOptions = ipaCandidates(text);
  const values = {
    ipa: ipaOptions.us || ipaOptions.uk || ipaOptions.other,
    partOfSpeech: "",
    family: "",
    example: "",
    meaning: "",
  };
  const meaningLines = [];
  const familyLines = [];
  let section = "";

  for (const line of lines) {
    const posValue = afterLabel(
      line,
      /^(?:loại từ|từ loại|part of speech|word class)\s*[:：-]\s*(.*)$/iu,
    );
    if (posValue !== null) {
      values.partOfSpeech ||= partOfSpeech(posValue) || posValue.slice(0, 100);
      section = "";
      continue;
    }
    const meaningValue = afterLabel(
      line,
      /^(?:nghĩa(?: tiếng việt)?|ý nghĩa(?:\s*\(meaning\))?|meaning|dịch nghĩa)(?:\s*[:：]\s*(.*))?$/iu,
    );
    if (meaningValue !== null) {
      section = "meaning";
      if (meaningValue && VIETNAMESE.test(meaningValue))
        meaningLines.push(meaningValue);
      continue;
    }
    const familyValue = afterLabel(
      line,
      /^(?:họ từ(?:\s*\(word family\))?|word family)(?:\s*[:：]\s*(.*))?$/iu,
    );
    if (familyValue !== null) {
      section = "family";
      if (familyValue) familyLines.push(familyValue);
      continue;
    }
    const exampleValue = afterLabel(
      line,
      /^(?:ví dụ|example|câu ví dụ)\s*[:：]\s*(.*)$/iu,
    );
    if (exampleValue !== null) {
      if (!values.example && exampleValue) {
        values.example = exampleValue
          .replace(/\s*\([^)]*[À-ỹĐđ][^)]*\)\.?\s*$/u, "")
          .slice(0, 1000);
      }
      continue;
    }
    if (/^(?:phát âm|pronunciation|ipa)(?:\s|\(|:|$)/iu.test(line)) {
      section = "";
      continue;
    }
    if (!values.partOfSpeech) {
      const narrative = line.match(
        /\blà\s+(danh từ|động từ|tính từ|trạng từ)(?=\s|$|[,.])/iu,
      );
      if (narrative) values.partOfSpeech = partOfSpeech(narrative[1]);
      else if (/\b(noun|verb|adjective|adverb)(?:\s*\[[^\]]+\])?$/iu.test(line))
        values.partOfSpeech = partOfSpeech(line);
    }
    if (
      section === "meaning" &&
      VIETNAMESE.test(line) &&
      meaningLines.length < 4
    )
      meaningLines.push(line);
    if (section === "family" && familyLines.length < 3 && /[a-z]/iu.test(line))
      familyLines.push(line);
  }

  values.meaning = meaningLines.join("\n").slice(0, 1000);
  values.family = familyLines.join(", ").slice(0, 500);
  if (type === "sentence") {
    values.partOfSpeech = "";
    values.family = "";
    values.example = "";
  }
  return { values, ipaOptions };
}
