import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");
const dryRun = process.argv.includes("--dry-run");

async function requireFreshBackup() {
  const stateStat = await fs.stat(statePath);
  const files = await fs.readdir(backupRoot).catch(() => []);
  const backups = [];
  for (const file of files.filter((item) => /^creative-library-state\..+\.json$/.test(item))) {
    const filePath = path.join(backupRoot, file);
    const stat = await fs.stat(filePath);
    backups.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  const latest = backups.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest || latest.mtimeMs < stateStat.mtimeMs) {
    throw new Error("Fresh backup required. Run: npm run backup:data");
  }
  return path.relative(repoRoot, latest.filePath);
}

function validUploadedDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const candidates = (state.videos || []).filter((video) =>
  video.source_site === "best_ads" && !video.publish_date && validUploadedDate(video.source_uploaded_at)
);
const years = {};
let metadataStatusRemoved = 0;

for (const video of candidates) {
  const publishDate = validUploadedDate(video.source_uploaded_at);
  video.publish_date = publishDate;
  video.publish_date_source = "source_uploaded_only";
  video.publish_date_confidence = video.publish_date_confidence || "unverified";
  const year = publishDate.slice(0, 4);
  years[year] = (years[year] || 0) + 1;
  if (video.duration_seconds && (video.status_ids || []).includes("metadata_missing")) {
    video.status_ids = video.status_ids.filter((statusId) => statusId !== "metadata_missing");
    metadataStatusRemoved += 1;
  }
}

let backup = null;
if (!dryRun && candidates.length) {
  backup = await requireFreshBackup();
  state.updated_at = new Date().toISOString();
  const temporaryPath = `${statePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, statePath);
}

console.log(JSON.stringify({
  ok: true,
  dry_run: dryRun,
  backup,
  best_ads_records: (state.videos || []).filter((video) => video.source_site === "best_ads").length,
  publish_dates_backfilled: candidates.length,
  metadata_missing_status_removed: metadataStatusRemoved,
  years,
}, null, 2));
