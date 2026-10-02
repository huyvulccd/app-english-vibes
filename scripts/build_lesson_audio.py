"""Prepare browser-ready audio and an index from the supplied course CDs."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "SOURCE" / "extracted" / "New-english-file"
STAGING = PROJECT / "SOURCE" / "audio-sites"
MANIFEST = PROJECT / "lesson-audio.json"
LEVELS = {
    "1.BEGINNER": "beginner",
    "2.ELEMENTARY": "elementary",
    "3.PRE-INTERMEDIATE": "pre-intermediate",
    "4.INTERMEDIATE": "intermediate",
    "5.UPPER-INTERMEDIATE": "upper-intermediate",
    "6.ADVANCED": "advanced",
}
AUDIO_SUFFIXES = {".mp3", ".ogg", ".wma", ".aif", ".aiff", ".wav"}


def id_for(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def topic_for(path: str) -> str:
    lower = path.lower()
    for term, topic in (
        ("pronoun", "pronunciation"), ("vocab", "vocabulary"),
        ("wordsandphrases", "vocabulary"), ("grammar", "grammar"),
        ("practical", "communication"), ("dictation", "dictation"),
        ("exam", "tests"), ("test", "tests"),
    ):
        if term in lower:
            return topic
    return "listening"


def track_for(name: str) -> str:
    match = re.search(r"(?<!\d)([1-9]|1[0-2])\.(\d{1,2})(?!\d)", name)
    return f"{match.group(1)}.{match.group(2)}" if match else ""


def add_audio(items: list[dict], relative: str, source: Path, title: str = "", track: str = "", unique: str = "") -> tuple[dict, Path]:
    level = relative.split("/", 1)[0]
    identifier = id_for(unique or relative)
    destination = STAGING / f"app-english-vibes-audio-{LEVELS[level]}" / "audio" / f"{identifier}.mp3"
    destination.parent.mkdir(parents=True, exist_ok=True)
    item = {
        "id": identifier,
        "level": level,
        "name": source.name,
        "title": title or re.sub(r"(?i)(\.mp3|\.ogg|\.wma|\.aif|\.aiff|\.wav)+$", "", source.name),
        "path": relative,
        "topic": topic_for(relative),
        "track": track or track_for(relative),
    }
    items.append(item)
    return item, destination


def convert_audio(source: Path, destination: Path, start: float | None = None, duration: float | None = None) -> None:
    if destination.is_file() and destination.stat().st_size > 0:
        return
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    if start is not None:
        command += ["-ss", f"{start:.3f}"]
    command += ["-i", str(source)]
    if duration is not None:
        command += ["-t", f"{duration:.3f}"]
    command += ["-vn", "-c:a", "libmp3lame", "-q:a", "4", str(destination)]
    subprocess.run(command, check=True)


def cue_tracks(cue: Path) -> list[tuple[int, str, float]]:
    raw = cue.read_text(encoding="utf-8", errors="replace")
    tracks = []
    current_number = None
    current_title = ""
    for line in raw.splitlines():
        track = re.search(r"\bTRACK\s+(\d+)\s+AUDIO", line)
        if track:
            current_number = int(track.group(1))
            current_title = ""
        title = re.search(r'^\s*TITLE\s+"([^"]+)"', line)
        if title and current_number is not None:
            current_title = title.group(1)
        index = re.search(r"\bINDEX\s+01\s+(\d+):(\d+):(\d+)", line)
        if index and current_number is not None:
            minute, second, frame = map(int, index.groups())
            tracks.append((current_number, current_title, minute * 60 + second + frame / 75))
    return tracks


def duration_of(source: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def main():
    items = []
    source_files = sorted((path for path in SOURCE.rglob("*") if path.is_file() and path.suffix.lower() in AUDIO_SUFFIXES), key=lambda path: str(path).casefold())
    for index, source in enumerate(source_files, 1):
        relative = source.relative_to(SOURCE).as_posix()
        item, destination = add_audio(items, relative, source)
        if source.suffix.lower() == ".mp3":
            if not destination.is_file():
                try: os.link(source, destination)
                except OSError:
                    import shutil
                    shutil.copyfile(source, destination)
        else:
            convert_audio(source, destination)
        if index % 500 == 0:
            print(f"Prepared {index}/{len(source_files)} source audio files", flush=True)

    for cue in sorted(SOURCE.rglob("*.cue")):
        match = re.search(r'^\s*FILE\s+"([^"]+)"', cue.read_text(encoding="utf-8", errors="replace"), re.MULTILINE)
        if not match:
            continue
        source = cue.parent / match.group(1)
        if not source.is_file():
            continue
        tracks = cue_tracks(cue)
        if len(tracks) < 2:
            continue
        full_duration = duration_of(source)
        for position, (number, title, start) in enumerate(tracks):
            stop = tracks[position + 1][2] if position + 1 < len(tracks) else full_duration
            if stop <= start:
                continue
            relative = source.relative_to(SOURCE).as_posix()
            ref = track_for(title)
            unique = f"{relative}#track-{number}"
            item, destination = add_audio(items, relative, source, title=title or f"Track {number:02}", track=ref, unique=unique)
            item["name"] = f"Track {number:02} · {source.name}"
            convert_audio(source, destination, start, stop - start)
        print(f"Split {cue.name} into {len(tracks)} tracks", flush=True)

    for level, slug in LEVELS.items():
        site = STAGING / f"app-english-vibes-audio-{slug}"
        site.mkdir(parents=True, exist_ok=True)
        (site / ".nojekyll").write_text("", encoding="utf-8")
        (site / "index.html").write_text(
            f'<!doctype html><html lang="vi"><meta charset="utf-8"><title>SayBack audio · {slug}</title><p>Audio học tiếng Anh cấp độ {slug}.</p><p><a href="https://huyvulccd.github.io/app-english-vibes/study.html">Mở SayBack</a></p></html>\n',
            encoding="utf-8",
        )
    items.sort(key=lambda item: (item["level"], item["path"].casefold(), item["title"].casefold()))
    MANIFEST.write_text(json.dumps({"files": items}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Done: {len(items)} browser-ready audio tracks", flush=True)
    for level, slug in LEVELS.items():
        directory = STAGING / f"app-english-vibes-audio-{slug}" / "audio"
        files = list(directory.glob("*.mp3"))
        size = sum(file.stat().st_size for file in files)
        print(f"{level}: {len(files)} tracks, {size / 1024 / 1024:.1f} MiB", flush=True)


if __name__ == "__main__":
    main()
