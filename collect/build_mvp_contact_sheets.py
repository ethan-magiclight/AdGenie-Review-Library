#!/usr/bin/env python3
"""Build deterministic storyboard contact sheets for MVP candidate review."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = REPO_ROOT / "collect" / "mvp-frame-review-v1.json"
OUTPUT_ROOT = REPO_ROOT / "collect" / "mvp-contact-sheets-v1"
INDIVIDUAL_DIR = OUTPUT_ROOT / "individual"
BATCH_DIR = OUTPUT_ROOT / "batches"
MANIFEST_PATH = OUTPUT_ROOT / "manifest.json"

TILE_WIDTH = 320
TILE_HEIGHT = 180
HEADER_HEIGHT = 92
FRAMES_PER_ROW = 5
VIDEOS_PER_BATCH = 4


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


TITLE_FONT = load_font(24, bold=True)
META_FONT = load_font(18)
TIME_FONT = load_font(16, bold=True)


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int, font: ImageFont.ImageFont) -> str:
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


def crop_frame(frame: dict) -> Image.Image:
    composite_path = Path(frame["composite_path"])
    if not composite_path.exists():
        raise FileNotFoundError(f"Missing storyboard composite: {composite_path}")

    width = int(frame["width"])
    height = int(frame["height"])
    left = int(frame["tile_column"]) * width
    top = int(frame["tile_row"]) * height
    right = left + width
    bottom = top + height

    with Image.open(composite_path) as composite:
        composite = composite.convert("RGB")
        if right > composite.width or bottom > composite.height:
            raise ValueError(
                f"Tile outside composite for {composite_path}: "
                f"tile=({left},{top},{right},{bottom}) composite={composite.size}"
            )
        tile = composite.crop((left, top, right, bottom))

    tile = ImageOps.fit(tile, (TILE_WIDTH, TILE_HEIGHT), method=Image.Resampling.LANCZOS)
    tile = ImageOps.expand(tile, border=1, fill="#FFFFFF")
    tile = ImageOps.fit(tile, (TILE_WIDTH, TILE_HEIGHT), method=Image.Resampling.LANCZOS)
    return tile


def build_individual(record: dict, output_path: Path) -> None:
    frames = record["frames"]
    if len(frames) != 10:
        raise ValueError(f"Expected 10 frames for {record['video_id']}, got {len(frames)}")

    canvas = Image.new(
        "RGB",
        (TILE_WIDTH * FRAMES_PER_ROW, HEADER_HEIGHT + TILE_HEIGHT * 2),
        "#111827",
    )
    draw = ImageDraw.Draw(canvas)
    metadata = record["browser_metadata"]
    title = fit_text(draw, metadata["title"], canvas.width - 32, TITLE_FONT)
    channel = metadata["channel"]
    duration = metadata["duration_seconds"]
    product = record["product_category"]
    draw.text((16, 10), title, font=TITLE_FONT, fill="#FFFFFF")
    draw.text(
        (16, 48),
        f"{record['video_id']}  |  {record['expected_brand']}  |  {channel}  |  {duration}s  |  {product}",
        font=META_FONT,
        fill="#CBD5E1",
    )

    for index, frame in enumerate(frames):
        tile = crop_frame(frame)
        column = index % FRAMES_PER_ROW
        row = index // FRAMES_PER_ROW
        x = column * TILE_WIDTH
        y = HEADER_HEIGHT + row * TILE_HEIGHT
        canvas.paste(tile, (x, y))
        seconds = float(frame["target_seconds"])
        label = f"{seconds:.1f}".rstrip("0").rstrip(".") + "s"
        label_box = draw.textbbox((0, 0), label, font=TIME_FONT)
        label_width = label_box[2] - label_box[0] + 14
        draw.rectangle((x + 6, y + 6, x + 6 + label_width, y + 32), fill="#111827")
        draw.text((x + 13, y + 9), label, font=TIME_FONT, fill="#FFFFFF")

    canvas.save(output_path, quality=92, optimize=True)


def build_batches(manifest_records: list[dict]) -> list[dict]:
    batches = []
    individual_height = HEADER_HEIGHT + TILE_HEIGHT * 2
    for batch_index in range(0, len(manifest_records), VIDEOS_PER_BATCH):
        members = manifest_records[batch_index : batch_index + VIDEOS_PER_BATCH]
        images = [Image.open(member["contact_sheet"]).convert("RGB") for member in members]
        batch = Image.new(
            "RGB",
            (TILE_WIDTH * FRAMES_PER_ROW, individual_height * len(images)),
            "#0F172A",
        )
        for row, image in enumerate(images):
            batch.paste(image, (0, row * individual_height))
            image.close()

        batch_number = batch_index // VIDEOS_PER_BATCH + 1
        batch_path = BATCH_DIR / f"batch-{batch_number:02d}.jpg"
        batch.save(batch_path, quality=91, optimize=True)
        batches.append(
            {
                "batch": batch_number,
                "path": str(batch_path),
                "video_ids": [member["video_id"] for member in members],
            }
        )
    return batches


def main() -> None:
    payload = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    records = [record for record in payload["records"] if record["hard_filter_status"] == "passed"]
    records.sort(key=lambda item: (item["product_category"], item["expected_brand"], item["video_id"]))

    INDIVIDUAL_DIR.mkdir(parents=True, exist_ok=True)
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    manifest_records = []
    for index, record in enumerate(records, start=1):
        output_path = INDIVIDUAL_DIR / f"{index:03d}-{record['video_id']}.jpg"
        build_individual(record, output_path)
        metadata = record["browser_metadata"]
        manifest_records.append(
            {
                "index": index,
                "video_id": record["video_id"],
                "url": record["url"],
                "product_category": record["product_category"],
                "expected_brand": record["expected_brand"],
                "title": metadata["title"],
                "channel": metadata["channel"],
                "duration_seconds": metadata["duration_seconds"],
                "publish_date": metadata["publish_date"],
                "discovered_for_genres": record["discovered_for_genres"],
                "contact_sheet": str(output_path),
            }
        )

    batches = build_batches(manifest_records)
    manifest = {
        "version": 1,
        "source": str(INPUT_PATH),
        "record_count": len(manifest_records),
        "batch_count": len(batches),
        "records": manifest_records,
        "batches": batches,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(manifest_records), "batches": len(batches), "manifest": str(MANIFEST_PATH)}))


if __name__ == "__main__":
    main()
