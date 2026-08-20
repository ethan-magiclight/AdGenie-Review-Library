import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const collectRoot = path.join(repoRoot, "collect");
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
  return (
    url.match(/[?&]v=([^&]+)/)?.[1] ||
    url.match(/youtu\.be\/([^?]+)/)?.[1] ||
    url.match(/youtube\.com\/shorts\/([^?]+)/)?.[1] ||
    null
  );
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function validateVisualReview(candidate, policy) {
  const gate = policy.visual_quality_gate;
  const review = candidate.visual_review;
  const failures = [];
  if (!review || typeof review !== "object") return ["visual_review_evidence_required"];
  if (review.decision !== "passed") failures.push("visual_review_must_pass");
  if (!gate.allowed_content_natures.includes(review.content_nature)) failures.push("brand_ad_content_nature_required");
  if (Number(review.frames_reviewed) < policy.classification.required_frames) failures.push("insufficient_reviewed_frames");
  if (Number(review.product_frame_ratio) < gate.minimum_product_frame_ratio) failures.push("product_visual_subject_insufficient");
  for (const key of gate.required_ad_structure) {
    if (review.ad_structure?.[key] !== true) failures.push(`ad_structure_${key}_required`);
  }
  if (Number(review.visual_quality_score) < gate.minimum_score) failures.push("visual_quality_score_below_gate");
  const reasonCodes = unique(candidate.decision_reason_codes || candidate.reason_codes);
  if (reasonCodes.some((code) => gate.hard_exclusion_codes.includes(code))) failures.push("hard_exclusion_code_present");
  if (!candidate.contact_sheet) failures.push("contact_sheet_required");
  return unique(failures);
}

function buildNote(candidate) {
  const parts = [];
  if (candidate.quality_candidate_reason) parts.push(candidate.quality_candidate_reason);
  if (Array.isArray(candidate.source_evidence) && candidate.source_evidence.length) {
    parts.push(`证据：${candidate.source_evidence.join("；")}`);
  }
  return parts.join("\n");
}

function sourcePlatform(candidate) {
  if (candidate.source_platform) return candidate.source_platform;
  return /youtu(?:\.be|be\.com)/i.test(candidate.url || "") ? "youtube" : "unknown";
}

function sourcePostId(candidate, videoId) {
  return candidate.source_post_id || (sourcePlatform(candidate) === "youtube" ? videoId : null);
}

function normalizeUrl(platform, postId, url) {
  if (platform === "youtube" && postId) return `https://www.youtube.com/watch?v=${postId}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["feature", "si"].includes(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function toMediaPath(value, candidatesRoot) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/media/")) return value;
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(candidatesRoot, value);
  const relative = path.relative(collectRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`contact_sheet must be inside collect/: ${value}`);
  }
  return `/media/collect/${relative.split(path.sep).join("/")}`;
}

function normalizeCandidate(candidate, statuses, importedFrom, candidatesRoot) {
  const videoId = candidate.video_id || videoIdFromUrl(candidate.url);
  if (!videoId) throw new Error(`candidate missing video_id: ${candidate.title || candidate.url || "untitled"}`);

  const url = candidate.url || `https://www.youtube.com/watch?v=${videoId}`;
  const platform = sourcePlatform(candidate);
  const postId = sourcePostId(candidate, videoId);
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
    contact_sheet: toMediaPath(candidate.contact_sheet, candidatesRoot),
    title: candidate.title || "",
    brand: candidate.brand || "",
    industry: candidate.industry || "Consumer Electronics",
    product_category: candidate.product_category || "Unclassified",
    genres,
    primary_genre: primaryGenre,
    secondary_genres: secondaryGenres,
    source_type: candidate.source_type || "",
    source_platform: platform,
    source_post_id: postId,
    platform_format: candidate.platform_format || "",
    source_account: candidate.source_account || "",
    source_account_id: candidate.source_account_id || "",
    source_account_type: candidate.source_account_type || candidate.publisher_role || "",
    normalized_url: normalizeUrl(platform, postId, url),
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    aspect_ratio: candidate.aspect_ratio || "unknown",
    is_vertical: Boolean(candidate.is_vertical),
    is_paid_ad: Boolean(candidate.is_paid_ad),
    view_count: candidate.view_count ?? null,
    published_at: candidate.published_at || null,
    collected_at: candidate.collected_at || null,
    collection_rule_version: candidate.collection_rule_version || "",
    collection_batch: candidate.collection_batch || importedFrom,
    discovery_score: candidate.discovery_score ?? null,
    discovery_score_breakdown: candidate.discovery_score_breakdown || null,
    quality_score: candidate.quality_score ?? null,
    quality_score_breakdown: candidate.quality_score_breakdown || null,
    discovery_source: candidate.discovery_source || "",
    note,
    visual_notes: candidate.visual_notes || note,
    reason_codes: unique(candidate.reason_codes || candidate.decision_reason_codes),
    decision_reason_codes: unique(candidate.decision_reason_codes || candidate.reason_codes),
    duration_seconds: candidate.duration_seconds ?? null,
    publish_date: candidate.publish_date ?? null,
    canonical_master_id: candidate.canonical_master_id || videoId,
    review_status: "imported",
    visual_review_status: candidate.visual_review_status || "completed",
    publisher_role: candidate.publisher_role || "",
    content_nature: candidate.visual_review?.content_nature || candidate.content_nature || "candidate_pending_review",
    recency_status: candidate.publish_date ? "" : "metadata_pending",
    ai_generation_value: candidate.ai_generation_value || "",
    ai_template_fit: Boolean(candidate.ai_template_fit),
    core_template_eligible: false,
    frames_reviewed: candidate.visual_review?.frames_reviewed ?? candidate.frames_reviewed ?? null,
    visual_review: candidate.visual_review || null,
    blacklisted: Boolean(candidate.blacklisted),
    status_ids: unique(statusIds),
    review_events: [],
    imported_from: importedFrom,
    updated_at: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));
const importedFrom = path.relative(repoRoot, args.file);
const candidatesRoot = path.dirname(args.file);
const [statePayload, candidatePayload] = await Promise.all([
  fs.readFile(statePath, "utf8"),
  fs.readFile(args.file, "utf8"),
]);

const state = JSON.parse(statePayload);
const candidateFile = JSON.parse(candidatePayload);
const policyFiles = (await fs.readdir(collectRoot)).filter((file) => file.endsWith("collection-policy-v1.json"));
const policies = await Promise.all(
  policyFiles.map(async (file) => {
    try {
      const policy = JSON.parse(await fs.readFile(path.join(collectRoot, file), "utf8"));
      return [policy.rule_version, policy];
    } catch {
      return null;
    }
  }),
);
const policiesByRuleVersion = new Map(policies.filter(Boolean));
function policyForCandidate(candidate) {
  return policiesByRuleVersion.get(candidate.collection_rule_version)
    || policiesByRuleVersion.get(candidateFile.collection_rule_version)
    || null;
}
const statuses = new Set((state.statuses || []).map((status) => status.id));
const industries = new Set((state.industries || []).map((item) => item.industry));
const categoryKeys = new Set((state.categories || []).map((item) => `${item.industry || ""}::${item.category}`));
const existingIds = new Set((state.videos || []).map((video) => video.video_id || video.id));
const existingUrls = new Set((state.videos || []).map((video) => video.url).filter(Boolean));
const existingNormalizedUrls = new Set(
  (state.videos || [])
    .map((video) => normalizeUrl(sourcePlatform(video), sourcePostId(video, video.video_id || video.id), video.url))
    .filter(Boolean),
);
const existingSourceKeys = new Set(
  (state.videos || [])
    .map((video) => {
      const platform = sourcePlatform(video);
      const postId = sourcePostId(video, video.video_id || video.id);
      return platform && postId ? `${platform}:${postId}` : null;
    })
    .filter(Boolean),
);
const existingCanonicalMasters = new Set(
  (state.videos || []).map((video) => video.canonical_master_id).filter(Boolean),
);
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
  const genres = unique(candidate.genres);
  if (candidate.review_status === "pending_visual_review" || !genres.length) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "visual_review_and_formal_genres_required" });
    continue;
  }
  const policy = policyForCandidate(candidate);
  if (!policy || policy.industry !== candidate.industry) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "matching_collection_policy_required" });
    continue;
  }
  if (!candidate.industry || !industries.has(candidate.industry)) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "unknown_or_missing_industry" });
    continue;
  }
  if (!candidate.product_category || !categoryKeys.has(`${candidate.industry}::${candidate.product_category}`)) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "unknown_or_missing_product_category" });
    continue;
  }
  const platform = sourcePlatform(candidate);
  if (platform !== "youtube") {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "unsupported_preview_platform" });
    continue;
  }
  const visualReviewFailures = validateVisualReview(candidate, policy);
  if (visualReviewFailures.length) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: visualReviewFailures.join(",") });
    continue;
  }
  const postId = sourcePostId(candidate, videoId);
  const sourceKey = platform && postId ? `${platform}:${postId}` : null;
  const normalized = normalizeUrl(platform, postId, url);
  const canonicalMaster = candidate.canonical_master_id || videoId;
  if (
    existingIds.has(videoId) ||
    existingUrls.has(url) ||
    existingNormalizedUrls.has(normalized) ||
    (sourceKey && existingSourceKeys.has(sourceKey)) ||
    existingCanonicalMasters.has(canonicalMaster)
  ) {
    skipped.push({ video_id: videoId, title: candidate.title, reason: "duplicate_existing_video" });
    continue;
  }
  const video = normalizeCandidate(candidate, statuses, importedFrom, candidatesRoot);
  added.push(video);
  existingIds.add(video.video_id);
  existingUrls.add(video.url);
  existingNormalizedUrls.add(video.normalized_url);
  if (video.source_platform && video.source_post_id) {
    existingSourceKeys.add(`${video.source_platform}:${video.source_post_id}`);
  }
  existingCanonicalMasters.add(video.canonical_master_id);
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
