#!/usr/bin/env python3
"""Download low-res gap candidates and build 10-frame contact sheets."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
COLLECT_DIR = REPO_ROOT / "collect"
INPUT_NAME = os.environ.get("GAP_ENRICHED_FILE", "mvp-gap-enriched-v1-multi-unbox.json")
OUTPUT_SUFFIX = os.environ.get("GAP_OUTPUT_SUFFIX", "multi-unbox")
INPUT_PATH = COLLECT_DIR / INPUT_NAME
OUTPUT_ROOT = COLLECT_DIR / f"mvp-gap-contact-sheets-v1-{OUTPUT_SUFFIX}"
VIDEO_DIR = OUTPUT_ROOT / "videos"
FRAME_DIR = OUTPUT_ROOT / "frames"
INDIVIDUAL_DIR = OUTPUT_ROOT / "individual"
MANIFEST_PATH = OUTPUT_ROOT / "manifest.json"

YT_DLP = "/Users/hakunamatata/.local/bin/yt-dlp"
FFMPEG = "/Users/hakunamatata/.local/bin/ffmpeg"

TILE_WIDTH = 320
TILE_HEIGHT = 180
HEADER_HEIGHT = 96
FRAMES_PER_ROW = 5


def load_font(size: int, bold: bool = False):
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


TITLE_FONT = load_font(22, True)
META_FONT = load_font(16)
TIME_FONT = load_font(15, True)


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int, font) -> str:
    if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
        return text
    suffix = "..."
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = text[:middle] + suffix
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            low = middle
        else:
            high = middle - 1
    return text[:low] + suffix


def download_video(record: dict) -> Path:
    video_id = record["video_id"]
    output_template = str(VIDEO_DIR / f"{video_id}.%(ext)s")
    run([
        YT_DLP,
        "-f",
        "bv*[height<=360][ext=mp4]/bv*[height<=360]/best[height<=360]/worst",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "-o",
        output_template,
        record["url"],
    ])
    matches = sorted(VIDEO_DIR.glob(f"{video_id}.*"))
    if not matches:
        raise FileNotFoundError(f"download did not produce a file for {video_id}")
    return matches[0]


def extract_frames(record: dict, video_path: Path) -> list[Path]:
    video_id = record["video_id"]
    duration = float(record["enriched"]["duration_seconds"])
    target_dir = FRAME_DIR / video_id
    target_dir.mkdir(parents=True, exist_ok=True)
    frame_paths = []
    for index in range(10):
        seconds = min(duration * index / 10, max(0.0, duration - 0.1))
        output_path = target_dir / f"{index:02d}.jpg"
        run([
            FFMPEG,
            "-y",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(output_path),
        ])
        frame_paths.append(output_path)
    return frame_paths


def build_sheet(record: dict, frame_paths: list[Path], output_path: Path) -> None:
    canvas = Image.new(
        "RGB",
        (TILE_WIDTH * FRAMES_PER_ROW, HEADER_HEIGHT + TILE_HEIGHT * 2),
        "#111827",
    )
    draw = ImageDraw.Draw(canvas)
    enriched = record["enriched"]
    title = fit_text(draw, enriched["title"], canvas.width - 32, TITLE_FONT)
    matches = " / ".join(
        sorted({
            f"{match['expected_brand']}:{match['target_genre']}"
            for match in record["discovery_matches"]
        })
    )
    draw.text((16, 10), title, font=TITLE_FONT, fill="#FFFFFF")
    draw.text(
        (16, 46),
        f"{record['video_id']} | {enriched['channel']} | {enriched['publish_date']} | {enriched['duration_seconds']}s",
        font=META_FONT,
        fill="#CBD5E1",
    )
    draw.text((16, 70), fit_text(draw, matches, canvas.width - 32, META_FONT), font=META_FONT, fill="#94A3B8")

    duration = float(enriched["duration_seconds"])
    for index, frame_path in enumerate(frame_paths):
        with Image.open(frame_path) as frame:
            tile = ImageOps.fit(frame.convert("RGB"), (TILE_WIDTH, TILE_HEIGHT), method=Image.Resampling.LANCZOS)
        column = index % FRAMES_PER_ROW
        row = index // FRAMES_PER_ROW
        x = column * TILE_WIDTH
        y = HEADER_HEIGHT + row * TILE_HEIGHT
        canvas.paste(tile, (x, y))
        seconds = min(duration * index / 10, max(0.0, duration - 0.1))
        label = f"{seconds:.1f}".rstrip("0").rstrip(".") + "s"
        label_box = draw.textbbox((0, 0), label, font=TIME_FONT)
        draw.rectangle((x + 6, y + 6, x + 20 + label_box[2], y + 31), fill="#111827")
        draw.text((x + 12, y + 8), label, font=TIME_FONT, fill="#FFFFFF")

    canvas.save(output_path, quality=92, optimize=True)


def main() -> None:
    payload = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    records = [
        record
        for record in payload["records"]
        if record.get("hard_filter_status") == "passed"
    ]
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    INDIVIDUAL_DIR.mkdir(parents=True, exist_ok=True)

    manifest_records = []
    for index, record in enumerate(records, start=1):
        video_id = record["video_id"]
        try:
            video_path = download_video(record)
            frame_paths = extract_frames(record, video_path)
            contact_path = INDIVIDUAL_DIR / f"{index:03d}-{video_id}.jpg"
            build_sheet(record, frame_paths, contact_path)
            status = "ok"
            error = None
        except Exception as exc:  # noqa: BLE001 - keep review moving and record failure.
            video_path = None
            contact_path = None
            status = "error"
            error = str(exc)

        manifest_records.append({
            "index": index,
            "video_id": video_id,
            "url": record["url"],
            "title": record["enriched"]["title"],
            "channel": record["enriched"]["channel"],
            "publish_date": record["enriched"]["publish_date"],
            "duration_seconds": record["enriched"]["duration_seconds"],
            "discovery_matches": record["discovery_matches"],
            "status": status,
            "error": error,
            "video_path": str(video_path) if video_path else None,
            "contact_sheet": str(contact_path) if contact_path else None,
        })
        print(json.dumps({"index": index, "video_id": video_id, "status": status}))

    manifest = {
        "version": 1,
        "source": str(INPUT_PATH),
        "record_count": len(manifest_records),
        "ok_count": sum(1 for item in manifest_records if item["status"] == "ok"),
        "records": manifest_records,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(manifest_records), "ok": manifest["ok_count"], "manifest": str(MANIFEST_PATH)}))


if __name__ == "__main__":
    main()
