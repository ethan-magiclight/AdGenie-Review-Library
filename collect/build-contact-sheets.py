#!/usr/bin/env python3
"""Download a collection batch and build aspect-aware 10-frame contact sheets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRAMES_PER_ROW = 5
FRAME_COUNT = 10


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--provider")
    parser.add_argument("--cookies-from-browser")
    parser.add_argument("--web-access-proxy", default=os.environ.get("WEB_ACCESS_PROXY", "http://localhost:3456"))
    return parser.parse_args()


def executable(env_name: str, command: str) -> str:
    configured = os.environ.get(env_name)
    if configured:
        return configured
    user_local = Path.home() / ".local" / "bin" / command
    if user_local.exists():
        return str(user_local)
    resolved = shutil.which(command)
    if not resolved:
        raise FileNotFoundError(f"Missing executable: {command}")
    return resolved


def run(command: list[str]) -> str:
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        return completed.stdout
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "unknown error").strip()
        detail = re.sub(r"([?&](?:token|signature|sig|expires|key|auth)=[^&\s]+)", "?[REDACTED]", detail, flags=re.IGNORECASE)
        raise RuntimeError(f"{Path(command[0]).name} failed: {detail[-2000:]}") from exc


def run_bytes(command: list[str]) -> bytes:
    try:
        completed = subprocess.run(command, check=True, capture_output=True)
        return completed.stdout
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or b"unknown error").decode("utf-8", errors="replace").strip()
        detail = re.sub(r"([?&](?:token|signature|sig|expires|key|auth)=[^&\s]+)", "?[REDACTED]", detail, flags=re.IGNORECASE)
        raise RuntimeError(f"{Path(command[0]).name} failed: {detail[-2000:]}") from exc


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "unknown"


def load_records(input_path: Path) -> list[dict]:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    records = payload.get("candidates") or payload.get("records") or payload.get("videos") or []
    jobs = []
    for record in records:
        if record.get("hard_filter_status") == "excluded" or record.get("record_state") == "excluded":
            continue
        video_assets = [asset for asset in record.get("media_assets", []) if asset.get("media_type") == "video"]
        if video_assets:
            for asset in video_assets:
                source_record_id = str(record.get("source_record_id") or record.get("campaign_id") or "unknown")
                asset_id = str(asset.get("asset_id") or asset.get("source_asset_id") or len(jobs) + 1)
                jobs.append({
                    **record,
                    "asset": asset,
                    "job_id": safe_id(f"{source_record_id}--{asset_id}"),
                    "video_id": asset.get("source_asset_id") or asset_id,
                    "url": asset.get("playback_url") or asset.get("original_url"),
                })
        else:
            video_id = str(record.get("video_id") or record.get("source_record_id") or len(jobs) + 1)
            jobs.append({**record, "asset": None, "job_id": safe_id(video_id), "video_id": video_id})
    return jobs


def proxy_json(proxy: str, endpoint: str, data: str | None = None) -> dict:
    request = urllib.request.Request(
        f"{proxy.rstrip('/')}{endpoint}",
        data=data.encode("utf-8") if data is not None else None,
        headers={"Content-Type": "text/plain; charset=utf-8"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def refresh_best_ads_url(record: dict, proxy: str) -> str:
    detail_url = record.get("source_detail_url")
    if not detail_url:
        raise ValueError("Best Ads signed media requires source_detail_url")
    target_id = None
    try:
        opened = proxy_json(proxy, f"/new?{urllib.parse.urlencode({'url': detail_url})}")
        target_id = opened.get("targetId")
        if not target_id:
            raise RuntimeError("CDP proxy did not return targetId")
        expression = "JSON.stringify([...new Set([...document.querySelectorAll('video source[src],video[src]')].map(element=>element.src||element.getAttribute('src')).filter(Boolean))])"
        deadline = time.monotonic() + 20
        urls = []
        while time.monotonic() < deadline and not urls:
            result = proxy_json(proxy, f"/eval?target={urllib.parse.quote(target_id)}", expression)
            urls = json.loads(result.get("value") or "[]")
            if not urls:
                time.sleep(0.5)
        if not urls:
            raise RuntimeError("Best Ads detail has no playable video source")
        expected_asset_id = str((record.get("asset") or {}).get("source_asset_id") or "")
        return next((url for url in urls if expected_asset_id and expected_asset_id in url), urls[0])
    finally:
        if target_id:
            try:
                proxy_json(proxy, f"/close?target={urllib.parse.quote(target_id)}")
            except Exception:
                pass


def stable_best_ads_url(record: dict) -> str | None:
    asset = record.get("asset") or {}
    value = asset.get("original_url")
    if not value:
        return None
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != "bestads-files.b-cdn.net":
        return None
    filename = urllib.parse.unquote(Path(parsed.path).name)
    asset_id = filename.rsplit(".", 1)[0]
    expected = str(asset.get("source_asset_id") or asset.get("asset_id") or "")
    if not expected or asset_id != expected:
        return None
    return urllib.parse.urlunparse(parsed._replace(query="", fragment=""))


def media_provider(record: dict) -> str:
    asset = record.get("asset") or {}
    if asset.get("provider"):
        return str(asset["provider"])
    return "youtube" if re.search(r"youtu(?:\.be|be\.com)", record.get("url") or "", re.IGNORECASE) else "mp4"


def media_url(record: dict, proxy: str) -> str:
    provider = media_provider(record)
    if provider == "best_ads_signed_mp4":
        return stable_best_ads_url(record) or refresh_best_ads_url(record, proxy)
    asset = record.get("asset") or {}
    value = asset.get("playback_url") or asset.get("original_url") or record.get("url")
    if not value:
        raise ValueError(f"Missing media URL for {record['job_id']}")
    return value


def download_video(
    record: dict,
    video_dir: Path,
    yt_dlp: str,
    ffmpeg: str,
    cookies_from_browser: str | None,
    proxy: str,
) -> Path:
    job_id = record["job_id"]
    existing = [item for item in sorted(video_dir.glob(f"{job_id}.*")) if not item.name.endswith(".part")]
    if existing:
        return existing[0]
    provider = media_provider(record)
    resolved_url = media_url(record, proxy)
    if provider in {"youtube", "vimeo"}:
        command = [
            yt_dlp,
            "-f",
            "bv*[height<=480][ext=mp4]/bv*[height<=480]/best[height<=480]/worst",
            "--no-playlist",
            "--no-warnings",
            "-o",
            str(video_dir / f"{job_id}.%(ext)s"),
        ]
        if cookies_from_browser:
            command.extend(["--cookies-from-browser", cookies_from_browser])
        command.append(resolved_url)
        run(command)
    else:
        output_path = video_dir / f"{job_id}.mp4"
        run([
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            resolved_url,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c",
            "copy",
            str(output_path),
        ])
    downloaded = [item for item in sorted(video_dir.glob(f"{job_id}.*")) if not item.name.endswith(".part")]
    if not downloaded:
        raise FileNotFoundError(f"Download did not produce a file for {job_id}")
    return downloaded[0]


def probe_video(video_path: Path, ffprobe: str) -> dict:
    payload = json.loads(
        run([
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(video_path),
        ])
    )
    stream = payload["streams"][0]
    return {
        "duration_seconds": float(payload["format"]["duration"]),
        "width": int(stream["width"]),
        "height": int(stream["height"]),
    }


def file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def difference_hash(frame_path: Path, ffmpeg: str) -> str:
    pixels = run_bytes([
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(frame_path),
        "-vf",
        "scale=9:8:flags=area,format=gray",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
    ])
    if len(pixels) != 72:
        raise RuntimeError(f"Expected 72 grayscale bytes for dHash, got {len(pixels)}")
    value = 0
    for row in range(8):
        for column in range(8):
            value = (value << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return f"{value:016x}"


def media_fingerprints(video_path: Path, frame_paths: list[Path], ffmpeg: str) -> dict:
    return {
        "content_sha256": file_sha256(video_path),
        "visual_fingerprint": {
            "algorithm": "dhash-9x8-v1",
            "frame_hashes": [difference_hash(frame_path, ffmpeg) for frame_path in frame_paths],
        },
    }


def extract_frames(job_id: str, video_path: Path, duration: float, frame_dir: Path, ffmpeg: str) -> list[Path]:
    target_dir = frame_dir / job_id
    target_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for index in range(FRAME_COUNT):
        seconds = min(duration * index / FRAME_COUNT, max(0.0, duration - 0.1))
        output_path = target_dir / f"{index:02d}.jpg"
        run([
            ffmpeg,
            "-y",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            f"drawtext=text='{seconds:.1f}s':x=8:y=8:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.7",
            "-q:v",
            "3",
            str(output_path),
        ])
        frames.append(output_path)
    return frames


def tile_dimensions(width: int, height: int) -> tuple[int, int]:
    if height > width:
        return 180, 320
    if width == height:
        return 240, 240
    return 320, 180


def build_sheet(metadata: dict, frame_paths: list[Path], output_path: Path, ffmpeg: str) -> None:
    tile_width, tile_height = tile_dimensions(metadata["width"], metadata["height"])
    pattern = str(frame_paths[0].parent / "%02d.jpg")
    run([
        ffmpeg,
        "-y",
        "-framerate",
        "1",
        "-i",
        pattern,
        "-vf",
        f"scale={tile_width}:{tile_height}:force_original_aspect_ratio=decrease,pad={tile_width}:{tile_height}:(ow-iw)/2:(oh-ih)/2:color=#020617,tile={FRAMES_PER_ROW}x2:padding=2:margin=2",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(output_path),
    ])


def validate_sheet(output_path: Path, frame_paths: list[Path], ffprobe: str) -> dict:
    if len(frame_paths) != FRAME_COUNT or not all(path.exists() and path.stat().st_size > 0 for path in frame_paths):
        raise RuntimeError(f"Expected {FRAME_COUNT} non-empty frames")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("Contact sheet is missing or empty")
    payload = json.loads(run([
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(output_path),
    ]))
    stream = payload["streams"][0]
    return {"width": int(stream["width"]), "height": int(stream["height"]), "frame_count": len(frame_paths)}


def cleanup_video_files(video_dir: Path, job_id: str) -> list[str]:
    removed = []
    for item in video_dir.glob(f"{job_id}.*"):
        if item.is_file():
            item.unlink(missing_ok=True)
            removed.append(str(item))
    return removed


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_root = Path(args.output_dir).resolve() if args.output_dir else input_path.with_suffix("").with_name(f"{input_path.stem}-contact-sheets")
    video_dir = output_root / "videos"
    frame_dir = output_root / "frames"
    individual_dir = output_root / "individual"
    manifest_path = output_root / "manifest.json"
    video_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)
    individual_dir.mkdir(parents=True, exist_ok=True)

    yt_dlp = executable("YT_DLP_PATH", "yt-dlp")
    ffmpeg = executable("FFMPEG_PATH", "ffmpeg")
    ffprobe = executable("FFPROBE_PATH", "ffprobe")
    records = load_records(input_path)
    if args.provider:
        records = [record for record in records if media_provider(record) == args.provider]
    if args.offset > 0:
        records = records[args.offset :]
    if args.limit > 0:
        records = records[: args.limit]

    manifest_records = []
    for index, record in enumerate(records, start=1):
        video_path = None
        contact_sheet = None
        metadata = None
        sheet_validation = None
        fingerprints = None
        removed_video_paths = []
        try:
            video_path = download_video(record, video_dir, yt_dlp, ffmpeg, args.cookies_from_browser, args.web_access_proxy)
            metadata = probe_video(video_path, ffprobe)
            frames = extract_frames(record["job_id"], video_path, metadata["duration_seconds"], frame_dir, ffmpeg)
            fingerprints = media_fingerprints(video_path, frames, ffmpeg)
            contact_sheet = individual_dir / f"{index:03d}-{record['job_id']}.jpg"
            build_sheet(metadata, frames, contact_sheet, ffmpeg)
            sheet_validation = validate_sheet(contact_sheet, frames, ffprobe)
            status = "ok"
            error = None
        except Exception as exc:
            status = "error"
            error = str(exc)
        finally:
            removed_video_paths = cleanup_video_files(video_dir, record["job_id"])
            video_path = None

        manifest_records.append({
            "index": index,
            "source_site": record.get("source_site"),
            "source_record_id": record.get("source_record_id"),
            "source_detail_url": record.get("source_detail_url"),
            "asset_id": (record.get("asset") or {}).get("asset_id"),
            "provider": media_provider(record),
            "video_id": record["video_id"],
            "url": record.get("url"),
            "title": record.get("title"),
            "brand": record.get("primary_brand") or record.get("brand"),
            "product_category": (record.get("classification_candidate") or {}).get("product_category") or record.get("product_category"),
            "recall_genres": record.get("recall_genres", []),
            "status": status,
            "error": error,
            "duration_seconds": metadata["duration_seconds"] if metadata else None,
            "width": metadata["width"] if metadata else None,
            "height": metadata["height"] if metadata else None,
            "content_sha256": fingerprints["content_sha256"] if fingerprints else None,
            "visual_fingerprint": fingerprints["visual_fingerprint"] if fingerprints else None,
            "video_path": str(video_path) if video_path else None,
            "contact_sheet": str(contact_sheet) if contact_sheet else None,
            "sheet_validation": sheet_validation,
            "temporary_video_cleanup": {"removed": removed_video_paths, "remaining": [str(item) for item in video_dir.glob(f"{record['job_id']}.*")]},
        })
        print(json.dumps({"index": index, "video_id": record["video_id"], "provider": media_provider(record), "status": status}, ensure_ascii=False))

    manifest = {
        "version": 2,
        "source": str(input_path),
        "record_count": len(manifest_records),
        "ok_count": sum(item["status"] == "ok" for item in manifest_records),
        "error_count": sum(item["status"] == "error" for item in manifest_records),
        "records": manifest_records,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": manifest["record_count"], "ok": manifest["ok_count"], "manifest": str(manifest_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
