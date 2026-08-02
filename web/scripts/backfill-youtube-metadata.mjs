import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");

const metadataStatusId = "metadata_missing";
const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";
const args = process.argv.slice(2);

function argValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const limit = Number(argValue("--limit", 0)) || 0;
const concurrency = Math.max(1, Math.min(Number(argValue("--concurrency", 3)) || 3, 6));
const cookiesFromBrowser = argValue("--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER || "");
const onlyIds = new Set(
  String(argValue("--ids", ""))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

function parseUploadDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function parseTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function videoUrl(video) {
  return video.url || `https://www.youtube.com/watch?v=${video.video_id || video.id}`;
}

function missingParts(video) {
  const parts = [];
  if (!video.publish_date) parts.push("publish_date");
  if (!video.duration_seconds) parts.push("duration_seconds");
  return parts;
}

function hasCompleteMetadata(video) {
  return Boolean(video.publish_date && video.duration_seconds);
}

function setMetadataStatus(video) {
  video.status_ids = video.status_ids || [];
  if (hasCompleteMetadata(video)) {
    video.status_ids = video.status_ids.filter((id) => id !== metadataStatusId);
    return;
  }
  if (!video.status_ids.includes(metadataStatusId)) video.status_ids.push(metadataStatusId);
}

async function fetchYoutubeMetadata(video) {
  const ytdlpArgs = [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
  ];
  if (cookiesFromBrowser) ytdlpArgs.push("--cookies-from-browser", cookiesFromBrowser);
  ytdlpArgs.push(videoUrl(video));

  const { stdout } = await execFileAsync(
    ytdlpBin,
    ytdlpArgs,
    {
      timeout: 90_000,
      maxBuffer: 24 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function applyMetadata(video, info, checkedAt) {
  const before = {
    publish_date: video.publish_date || null,
    duration_seconds: video.duration_seconds || null,
    status_ids: [...(video.status_ids || [])],
  };

  const uploadDate = parseUploadDate(info.upload_date || info.release_date) || parseTimestamp(info.timestamp);
  const duration = Number(info.duration);

  if ((force || !video.publish_date) && uploadDate) video.publish_date = uploadDate;
  if ((force || !video.duration_seconds) && Number.isFinite(duration) && duration > 0) {
    video.duration_seconds = Math.round(duration);
  }
  if (info.channel || info.uploader) video.youtube_channel_title = info.channel || info.uploader;
  if (info.channel_id || info.uploader_id) video.youtube_channel_id = info.channel_id || info.uploader_id;
  if (info.webpage_url) video.youtube_webpage_url = info.webpage_url;
  if (!video.thumbnail_url && info.thumbnail) video.thumbnail_url = info.thumbnail;
  video.metadata_source = "yt-dlp";
  video.metadata_checked_at = checkedAt;

  if (hasCompleteMetadata(video)) {
    delete video.metadata_error;
  } else {
    video.metadata_error = `metadata still missing: ${missingParts(video).join(", ")}`;
  }
  setMetadataStatus(video);

  return {
    before,
    after: {
      publish_date: video.publish_date || null,
      duration_seconds: video.duration_seconds || null,
      status_ids: [...(video.status_ids || [])],
    },
  };
}

async function mapLimit(items, workerCount, fn) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(workerCount, items.length) }, worker));
  return results;
}

async function main() {
  const state = JSON.parse(await fs.readFile(dataPath, "utf8"));
  const checkedAt = new Date().toISOString();
  let candidates = (state.videos || []).filter((video) => force || !hasCompleteMetadata(video));
  if (onlyIds.size) candidates = candidates.filter((video) => onlyIds.has(video.video_id || video.id));
  if (limit > 0) candidates = candidates.slice(0, limit);

  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "write",
    candidates: candidates.length,
    concurrency,
    force,
    cookies_from_browser: cookiesFromBrowser || null,
  }));

  if (!candidates.length) {
    console.log(JSON.stringify({ ok: true, updated: 0, failed: 0, skipped: 0 }, null, 2));
    return;
  }

  if (!dryRun) {
    await fs.mkdir(backupRoot, { recursive: true });
    const backupName = `creative-library-state.pre-metadata-backfill-${checkedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}.json`;
    await fs.copyFile(dataPath, path.join(backupRoot, backupName));
    console.log(JSON.stringify({ backup: path.join(backupRoot, backupName) }));
  }

  let completed = 0;
  let updated = 0;
  let failed = 0;
  const failures = [];
  const changes = [];

  await mapLimit(candidates, concurrency, async (video) => {
    const id = video.video_id || video.id;
    try {
      const info = await fetchYoutubeMetadata(video);
      const change = applyMetadata(video, info, checkedAt);
      changes.push({ video_id: id, ...change });
      if (hasCompleteMetadata(video)) updated += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      video.metadata_checked_at = checkedAt;
      video.metadata_source = "yt-dlp";
      video.metadata_error = String(error.stderr || error.message || error).slice(0, 1200);
      setMetadataStatus(video);
      failures.push({ video_id: id, title: video.title, error: video.metadata_error.slice(0, 240) });
    } finally {
      completed += 1;
      if (completed % 10 === 0 || completed === candidates.length) {
        console.log(JSON.stringify({ progress: completed, total: candidates.length, updated, failed }));
      }
    }
  });

  const complete = (state.videos || []).filter(hasCompleteMetadata).length;
  const missing = (state.videos || []).filter((video) => !hasCompleteMetadata(video)).length;

  if (!dryRun) {
    state.updated_at = checkedAt;
    state.metadata_backfill_runs = state.metadata_backfill_runs || [];
    state.metadata_backfill_runs.unshift({
      id: `metadata_${Date.now()}`,
      source: "yt-dlp",
      checked_at: checkedAt,
      candidates: candidates.length,
      updated,
      failed,
      complete,
      missing,
      failures: failures.slice(0, 30),
    });
    await fs.writeFile(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    dry_run: dryRun,
    candidates: candidates.length,
    updated,
    failed,
    complete,
    missing,
    failure_sample: failures.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
