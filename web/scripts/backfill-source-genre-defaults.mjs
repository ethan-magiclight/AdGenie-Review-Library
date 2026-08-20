import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genreDefaultsFromCandidates } from "../lib/genre-defaults.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");
const sourceSites = new Set(["best_ads", "ads_of_the_world"]);
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

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const candidates = (state.videos || []).filter((video) =>
  sourceSites.has(video.source_site) && !(video.genres || []).length && (video.genre_candidates || []).length
);
const bySource = {};
let genresWritten = 0;

for (const video of candidates) {
  const defaults = genreDefaultsFromCandidates(video.genre_candidates);
  if (!defaults.genres.length) continue;
  video.genres = defaults.genres;
  video.primary_genre = defaults.primary_genre;
  video.secondary_genres = defaults.secondary_genres;
  video.note = "AI 视觉预审题材已作为默认值写入；记录仍为待审核，需人工确认或纠正，批准状态不会自动变化。";
  genresWritten += defaults.genres.length;
  bySource[video.source_site] = (bySource[video.source_site] || 0) + 1;
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
  records_backfilled: candidates.length,
  genres_written: genresWritten,
  by_source: bySource,
}, null, 2));
