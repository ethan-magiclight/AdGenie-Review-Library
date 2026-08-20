import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");

function parseArgs(argv) {
  const parsed = { files: [], dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--dry-run") parsed.dryRun = true;
    else if (item === "--file") {
      parsed.files.push(path.resolve(process.cwd(), argv[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  if (!parsed.files.length) throw new Error("At least one --file is required.");
  return parsed;
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function videoIdFromUrl(url = "") {
  return (
    url.match(/[?&]v=([^&]+)/)?.[1] ||
    url.match(/youtu\.be\/([^?]+)/)?.[1] ||
    url.match(/youtube\.com\/shorts\/([^?]+)/)?.[1] ||
    null
  );
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

function buildReviewCandidate(candidate, importedFrom) {
  const videoId = candidate.video_id || videoIdFromUrl(candidate.url);
  const platform = sourcePlatform(candidate);
  const postId = sourcePostId(candidate, videoId);
  const url = candidate.url || `https://www.youtube.com/watch?v=${videoId}`;
  const noteParts = [
    "候选队列导入：仅用于审核台预览，不代表已通过正式题材、发布时间、抽帧或优质模板门禁。",
    candidate.metadata_status === "publish_date_missing" ? "发布时间缺失，需人工补元数据后才能判断近期性。" : null,
    (candidate.recall_genres || []).length ? `召回题材：${candidate.recall_genres.join(" / ")}` : null,
  ];

  return {
    id: videoId,
    video_id: videoId,
    url,
    embed_url: `https://www.youtube.com/embed/${videoId}`,
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    contact_sheet: candidate.contact_sheet || null,
    title: candidate.title || "",
    brand: candidate.brand || "",
    industry: candidate.industry,
    product_category: candidate.product_category,
    genres: [],
    primary_genre: null,
    secondary_genres: [],
    recall_genres: unique(candidate.recall_genres),
    source_type: candidate.source_type || "品牌官方",
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
    collected_at: candidate.collected_at || new Date().toISOString(),
    collection_rule_version: candidate.collection_rule_version || "",
    collection_batch: importedFrom,
    discovery_score: candidate.discovery_score ?? null,
    discovery_score_breakdown: candidate.discovery_score_breakdown || null,
    quality_score: null,
    quality_score_breakdown: null,
    discovery_source: candidate.discovery_source || "",
    note: noteParts.filter(Boolean).join("\n"),
    visual_notes: noteParts.filter(Boolean).join("\n"),
    reason_codes: unique(candidate.decision_reason_codes || candidate.reason_codes),
    decision_reason_codes: unique(candidate.decision_reason_codes || candidate.reason_codes),
    duration_seconds: candidate.duration_seconds ?? null,
    publish_date: candidate.publish_date ?? null,
    canonical_master_id: candidate.canonical_master_id || videoId,
    review_status: "pending_visual_review",
    visual_review_status: "pending",
    publisher_role: candidate.publisher_role || "",
    content_nature: "candidate_pending_review",
    recency_status: candidate.publish_date ? "" : "metadata_pending",
    ai_generation_value: "",
    ai_template_fit: false,
    core_template_eligible: false,
    frames_reviewed: null,
    visual_review: null,
    blacklisted: false,
    status_ids: unique(["pending_review", !candidate.publish_date || !candidate.duration_seconds ? "metadata_missing" : null]),
    review_events: [],
    imported_from: importedFrom,
    updated_at: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));
const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const industries = new Set((state.industries || []).map((item) => item.industry));
const categoryKeys = new Set((state.categories || []).map((item) => `${item.industry || ""}::${item.category}`));
const existingKeys = new Set(
  (state.videos || [])
    .flatMap((video) => [
      video.video_id || video.id,
      video.normalized_url,
      video.source_platform && video.source_post_id ? `${video.source_platform}:${video.source_post_id}` : null,
      video.canonical_master_id,
    ])
    .filter(Boolean),
);

const added = [];
const skipped = [];

for (const file of args.files) {
  const importedFrom = path.relative(repoRoot, file);
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  const candidates = payload.candidates || payload.videos || [];
  for (const candidate of candidates) {
    const videoId = candidate.video_id || videoIdFromUrl(candidate.url);
    if (!videoId) {
      skipped.push({ file: importedFrom, title: candidate.title, reason: "missing_video_id" });
      continue;
    }
    const platform = sourcePlatform(candidate);
    if (platform !== "youtube") {
      skipped.push({ file: importedFrom, video_id: videoId, title: candidate.title, reason: "unsupported_preview_platform" });
      continue;
    }
    if (!candidate.industry || !industries.has(candidate.industry)) {
      skipped.push({ file: importedFrom, video_id: videoId, title: candidate.title, reason: "unknown_or_missing_industry" });
      continue;
    }
    if (!candidate.product_category || !categoryKeys.has(`${candidate.industry}::${candidate.product_category}`)) {
      skipped.push({ file: importedFrom, video_id: videoId, title: candidate.title, reason: "unknown_or_missing_product_category" });
      continue;
    }
    const postId = sourcePostId(candidate, videoId);
    const normalized = normalizeUrl(platform, postId, candidate.url || `https://www.youtube.com/watch?v=${videoId}`);
    const sourceKey = platform && postId ? `${platform}:${postId}` : null;
    const canonicalMaster = candidate.canonical_master_id || videoId;
    if ([videoId, normalized, sourceKey, canonicalMaster].some((key) => key && existingKeys.has(key))) {
      skipped.push({ file: importedFrom, video_id: videoId, title: candidate.title, reason: "duplicate_existing_video" });
      continue;
    }
    const video = buildReviewCandidate(candidate, importedFrom);
    added.push(video);
    for (const key of [video.video_id, video.normalized_url, `${video.source_platform}:${video.source_post_id}`, video.canonical_master_id]) {
      if (key) existingKeys.add(key);
    }
  }
  state.source_files = unique([...(state.source_files || []), importedFrom]);
}

if (!args.dryRun && added.length) {
  state.videos.push(...added);
  state.videos.sort((left, right) => {
    const industry = String(left.industry || "").localeCompare(String(right.industry || ""));
    if (industry !== 0) return industry;
    const category = String(left.product_category || "").localeCompare(String(right.product_category || ""));
    if (category !== 0) return category;
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
  state.updated_at = new Date().toISOString();
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  ok: true,
  dry_run: args.dryRun,
  files: args.files.map((file) => path.relative(repoRoot, file)),
  added: added.length,
  skipped: skipped.length,
  skipped_preview: skipped.slice(0, 10),
}, null, 2));
