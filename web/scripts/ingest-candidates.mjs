import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const defaultCandidatesPath = path.join(repoRoot, "collect", "quality-expansion-candidates-v1.json");

function parseArgs(argv) {
  const parsed = {
    file: defaultCandidatesPath,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--dry-run") parsed.dryRun = true;
    if (item === "--file") {
      parsed.file = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

function videoIdFromUrl(url = "") {
  return url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/youtu\.be\/([^?]+)/)?.[1] || null;
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function buildNote(candidate) {
  const parts = [];
  if (candidate.quality_candidate_reason) parts.push(candidate.quality_candidate_reason);
  if (Array.isArray(candidate.source_evidence) && candidate.source_evidence.length) {
    parts.push(`证据：${candidate.source_evidence.join("；")}`);
  }
  return parts.join("\n");
}

function normalizeCandidate(candidate, statuses, importedFrom) {
  const videoId = candidate.video_id || videoIdFromUrl(candidate.url);
  if (!videoId) throw new Error(`candidate missing video_id: ${candidate.title || candidate.url || "untitled"}`);

  const url = candidate.url || `https://www.youtube.com/watch?v=${videoId}`;
  const genres = unique(candidate.genres);
  if (!genres.length) throw new Error(`candidate missing genres: ${videoId}`);

  const primaryGenre = candidate.primary_genre || genres[0];
  const secondaryGenres = unique(candidate.secondary_genres || genres.filter((genre) => genre !== primaryGenre));
  const statusIds = ["pending_review"];
  if (!candidate.publish_date || !candidate.duration_seconds) statusIds.push("metadata_missing");

  for (const statusId of statusIds) {
    if (!statuses.has(statusId)) throw new Error(`state is missing status id: ${statusId}`);
  }

  const note = buildNote(candidate);
  return {
    id: videoId,
    video_id: videoId,
    url,
    embed_url: `https://www.youtube.com/embed/${videoId}`,
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    contact_sheet: null,
    title: candidate.title || "",
    brand: candidate.brand || "",
    industry: candidate.industry || "Consumer Electronics",
    product_category: candidate.product_category || "Unclassified",
    genres,
    primary_genre: primaryGenre,
    secondary_genres: secondaryGenres,
    source_type: candidate.source_type || "",
    note,
    visual_notes: note,
    reason_codes: unique(candidate.reason_codes || candidate.decision_reason_codes),
    decision_reason_codes: unique(candidate.decision_reason_codes || candidate.reason_codes),
    duration_seconds: candidate.duration_seconds ?? null,
    publish_date: candidate.publish_date ?? null,
    canonical_master_id: candidate.canonical_master_id || videoId,
    review_status: "imported",
    publisher_role: candidate.publisher_role || "",
    content_nature: candidate.content_nature || "candidate_pending_review",
    recency_status: candidate.publish_date ? "" : "metadata_pending",
    ai_generation_value: "",
    ai_template_fit: false,
    core_template_eligible: false,
    frames_reviewed: null,
    blacklisted: false,
    status_ids: unique(statusIds),
    review_events: [],
    imported_from: importedFrom,
    updated_at: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));
const importedFrom = path.relative(repoRoot, args.file);
const [statePayload, candidatePayload] = await Promise.all([
  fs.readFile(statePath, "utf8"),
  fs.readFile(args.file, "utf8"),
]);

const state = JSON.parse(statePayload);
const candidateFile = JSON.parse(candidatePayload);
const statuses = new Set((state.statuses || []).map((status) => status.id));
const existingIds = new Set((state.videos || []).map((video) => video.video_id || video.id));
const existingUrls = new Set((state.videos || []).map((video) => video.url).filter(Boolean));
const candidates = candidateFile.candidates || candidateFile.videos || [];
const added = [];
const skipped = [];

for (const candidate of candidates) {
  const videoId = candidate.video_id || videoIdFromUrl(candidate.url);
  const url = candidate.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  if (!videoId || !url) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "missing_video_id_or_url" });
    continue;
  }
  if (existingIds.has(videoId) || existingUrls.has(url)) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "duplicate_existing_video" });
    continue;
  }
  const video = normalizeCandidate(candidate, statuses, importedFrom);
  added.push(video);
  existingIds.add(video.video_id);
  existingUrls.add(video.url);
}

const summary = {
  ok: true,
  file: importedFrom,
  dry_run: args.dryRun,
  candidates: candidates.length,
  added: added.length,
  skipped: skipped.length,
  skipped_preview: skipped.slice(0, 10),
};

if (!args.dryRun && added.length) {
  state.videos.push(...added);
  state.updated_at = new Date().toISOString();
  state.source_files = unique([...(state.source_files || []), importedFrom]);
  state.videos.sort((left, right) => {
    const category = String(left.product_category).localeCompare(String(right.product_category));
    if (category !== 0) return category;
    return String(left.title).localeCompare(String(right.title));
  });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(summary, null, 2));
