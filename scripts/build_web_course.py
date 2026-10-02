"""Convert the locally supplied New English File PDFs into web lesson assets.

Requires PyMuPDF, Pillow, and Tesseract OCR. The original PDFs stay in SOURCE/.
Generated images and lesson metadata are static files for GitHub Pages.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import time

import pymupdf
from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "SOURCE" / "extracted" / "New-english-file"
OUTPUT = PROJECT / "course-pages"
DATA = PROJECT / "lesson-data"
CHECKPOINTS = PROJECT / "SOURCE" / "lesson-checkpoints"
TESSERACT = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
LEVELS = [
    ("1.BEGINNER", "Beginner"),
    ("2.ELEMENTARY", "Elementary"),
    ("3.PRE-INTERMEDIATE", "Pre-Intermediate"),
    ("4.INTERMEDIATE", "Intermediate"),
    ("5.UPPER-INTERMEDIATE", "Upper-Intermediate"),
    ("6.ADVANCED", "Advanced"),
]
TOPICS = {
    "grammar": r"\bgram+ar\b",
    "vocabulary": r"\bvocab(?:ulary)?\b|words?\s+and\s+phrases?",
    "pronunciation": r"\bpronunciation\b|\bpronounce\b",
    "listening": r"\blistening\b|\blisten\b",
    "reading": r"\breading\b|\bread\b",
    "speaking": r"\bspeaking\b|\bspeak\b",
    "writing": r"\bwriting\b|\bwrite\b",
    "practical": r"\bpractical\s+english\b",
}


def role_of(pdf: Path, level_path: Path) -> str:
    name = pdf.name.lower()
    if pdf.parent == level_path and ("student" in name or re.search(r"\bsb\.pdf$", name)):
        return "student"
    if "workbook" in name or " wb " in f" {name} " or " wb (" in name:
        return "workbook"
    if "teacher" in name or " tb." in name:
        return "teacher"
    if "test" in name or "assessment" in str(pdf).lower() or "tests" in str(pdf).lower():
        return "test"
    if "grammar" in name:
        return "grammar"
    return "resource"


def book_id(relative_path: str) -> str:
    path = Path(relative_path)
    level = path.parts[0].split(".")[0]
    slug = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")[:42]
    digest = hashlib.sha1(relative_path.encode("utf-8")).hexdigest()[:8]
    return f"{level}-{slug}-{digest}"


def clean_text(raw: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in raw.replace("\x0c", "").splitlines()]
    result = []
    blank = False
    for line in lines:
        if line:
            result.append(line)
            blank = False
        elif not blank:
            result.append("")
            blank = True
    return "\n".join(result).strip()


def page_topics(text: str) -> list[str]:
    return [name for name, pattern in TOPICS.items() if re.search(pattern, text, re.IGNORECASE)]


def page_tracks(text: str) -> list[str]:
    lines = text.splitlines()
    found = set()
    for index, line in enumerate(lines):
        nearby = " ".join(lines[max(0, index - 1): min(len(lines), index + 2)])
        if re.search(r"listen|repeat|audio|track|\bcd\b", nearby, re.IGNORECASE):
            found.update(re.findall(r"\b(?:[1-9]|1[0-2])\.\d{1,2}\b", line))
    return sorted(found, key=lambda value: tuple(map(int, value.split("."))))


def page_activities(text: str) -> list[str]:
    prompts = []
    seen = set()
    pattern = re.compile(r"^(?:[a-h]|\d{1,2})?[.)]?\s*(?:listen|read|write|complete|match|choose|answer|fill|describe|discuss|ask|look|repeat|pronounce|underline|circle|compare|check|talk|make|put|find)\b", re.IGNORECASE)
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" •—-\t")
        if 15 <= len(line) <= 180 and pattern.match(line):
            key = line.casefold()
            if key not in seen:
                seen.add(key)
                prompts.append(line)
        if len(prompts) >= 12:
            break
    return prompts


def convert_chunk(task: tuple[str, str, str, int, int, int, int, int]) -> tuple[str, int, int]:
    relative_path, identifier, role, start, stop, width, quality, ocr_width = task
    pdf = SOURCE / relative_path
    image_directory = OUTPUT / identifier
    checkpoint_directory = CHECKPOINTS / identifier
    image_directory.mkdir(parents=True, exist_ok=True)
    checkpoint_directory.mkdir(parents=True, exist_ok=True)
    created = 0
    ocr_pages = 0
    with pymupdf.open(pdf) as document:
        for page_index in range(start, stop):
            number = page_index + 1
            image_path = image_directory / f"{number:03}.webp"
            metadata_path = checkpoint_directory / f"{number:03}.json"
            if image_path.is_file() and metadata_path.is_file():
                continue
            page = document[page_index]
            scale = width / page.rect.width
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            if not image_path.is_file():
                image.save(image_path, "WEBP", quality=quality, method=4)
                created += 1
            raw_text = page.get_text("text")
            used_ocr = len(raw_text.strip()) < 100 and role in {"student", "workbook", "test", "grammar"}
            if used_ocr:
                ocr_image = image.convert("L")
                if ocr_image.width > ocr_width:
                    ocr_image = ocr_image.resize((ocr_width, round(ocr_image.height * ocr_width / ocr_image.width)))
                buffer = BytesIO()
                ocr_image.save(buffer, "PNG")
                result = subprocess.run(
                    [str(TESSERACT), "stdin", "stdout", "-l", "eng", "--psm", "3"],
                    input=buffer.getvalue(), capture_output=True, timeout=75,
                )
                raw_text = result.stdout.decode("utf-8", errors="replace") if result.returncode == 0 else ""
                ocr_pages += 1
            text = clean_text(raw_text)
            metadata = {
                "number": number,
                "image": f"./course-pages/{identifier}/{number:03}.webp",
                "text": text,
                "topics": page_topics(text),
                "tracks": page_tracks(text),
                "activities": page_activities(text),
                "ocr": used_ocr,
            }
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return identifier, created, ocr_pages


def inventory(only_level: str | None) -> list[dict]:
    books = []
    for level, level_name in LEVELS:
        if only_level and level != only_level:
            continue
        level_path = SOURCE / level
        for pdf in sorted(level_path.rglob("*.pdf"), key=lambda item: str(item).casefold()):
            relative = pdf.relative_to(SOURCE).as_posix()
            with pymupdf.open(pdf) as document:
                pages = document.page_count
            role = role_of(pdf, level_path)
            books.append({
                "id": book_id(relative),
                "level": level,
                "levelName": level_name,
                "role": role,
                "title": f"New English File · {level_name} · Student's Book" if role == "student" else pdf.stem.replace("_", " ").replace(".", " ").strip(),
                "sourceName": pdf.name,
                "pages": pages,
                "sourcePath": relative,
            })
    return books


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only-level", choices=[level for level, _ in LEVELS])
    parser.add_argument("--workers", type=int, default=min(6, os.cpu_count() or 4))
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--quality", type=int, default=68)
    parser.add_argument("--ocr-width", type=int, default=850)
    args = parser.parse_args()
    if not SOURCE.is_dir() or not TESSERACT.is_file():
        raise SystemExit("The extracted SOURCE/ folder and Tesseract OCR are required.")
    books = inventory(args.only_level)
    total_pages = sum(book["pages"] for book in books)
    tasks = []
    for book in books:
        for start in range(0, book["pages"], 15):
            tasks.append((book["sourcePath"], book["id"], book["role"], start, min(start + 15, book["pages"]), args.width, args.quality, args.ocr_width))
    started = time.time()
    print(f"Converting {len(books)} PDFs, {total_pages} pages, {len(tasks)} chunks with {args.workers} workers", flush=True)
    completed = 0
    created = 0
    ocr_pages = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(convert_chunk, task): task for task in tasks}
        for future in as_completed(futures):
            identifier, count, ocr_count = future.result()
            created += count
            ocr_pages += ocr_count
            completed += 1
            if completed % 8 == 0 or completed == len(tasks):
                print(f"{completed}/{len(tasks)} chunks · {created} new images · {ocr_pages} OCR pages · {time.time() - started:.0f}s", flush=True)
    DATA.mkdir(exist_ok=True)
    for book in books:
        pages = []
        for number in range(1, book["pages"] + 1):
            checkpoint = CHECKPOINTS / book["id"] / f"{number:03}.json"
            page = json.loads(checkpoint.read_text(encoding="utf-8"))
            page["activities"] = page_activities(page.get("text", ""))
            pages.append(page)
        book["startPage"] = next((page["number"] for page in pages[:12] if page["number"] >= 4 and re.match(r"^G(?:\s|$)", page["text"]) and page["activities"]), 1) if book["role"] == "student" else 1
        (DATA / f"{book['id']}.json").write_text(json.dumps({"book": book, "pages": pages}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    catalog_path = DATA / "catalog.json"
    existing = []
    if catalog_path.is_file():
        existing = json.loads(catalog_path.read_text(encoding="utf-8")).get("books", [])
    existing = [book for book in existing if book["level"] not in {item["level"] for item in books}]
    all_books = existing + books
    all_books.sort(key=lambda item: (item["level"], ["student", "workbook", "grammar", "test", "teacher", "resource"].index(item["role"]), item["title"].casefold()))
    catalog_path.write_text(json.dumps({"levels": LEVELS, "books": all_books}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    image_bytes = sum(path.stat().st_size for path in OUTPUT.rglob("*.webp"))
    print(f"Done: {len(all_books)} books, {image_bytes / 1024 / 1024:.1f} MiB of images, {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    main()
