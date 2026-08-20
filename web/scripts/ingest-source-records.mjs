import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourceBatch } from "../../collect/validate-source-records.mjs";
import { genreDefaultsFromCandidates } from "../lib/genre-defaults.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const collectRoot = path.join(repoRoot, "collect");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");
const taxonomyPath = path.join(collectRoot, "adgenie-brand-taxonomy-v1.json");

function parseArgs(argv) {
  const result = { files: [], manifests: [], dryRun: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--file") {
      result.files.push(path.resolve(process.cwd(), argv[index + 1]));
      index += 1;
    } else if (item === "--manifest") {
      result.manifests.push(path.resolve(process.cwd(), argv[index + 1]));
      index += 1;
    } else if (item === "--dry-run") {
      result.dryRun = true;
    } else if (item === "--self-test") {
      result.selfTest = true;
    } else if (item === "--help" || item === "-h") {
      console.log("Usage: node web/scripts/ingest-source-records.mjs --file records.json [--file ...] [--manifest contact-sheet-manifest.json] [--dry-run] [--self-test]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  if (!result.selfTest && !result.files.length) throw new Error("At least one --file is required");
  return result;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.campaigns || payload.candidates || [];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sourceKey(record, asset) {
  return `${record.source_site}:${record.source_record_id}:${asset.source_asset_id || asset.asset_id}`;
}

function safeId(value) {
  return value.replace(/[^A-Za-z0-9._:-]+/g, "-");
}

function contactSheetPath(value) {
  if (!value) return null;
  if (value.startsWith("/media/collect/")) return value;
  const absolute = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
  const relative = path.relative(collectRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Contact sheet must be inside collect/: ${value}`);
  return `/media/collect/${relative.split(path.sep).join("/")}`;
}

function aspectRatio(asset) {
  if (asset.aspect_ratio) return asset.aspect_ratio;
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (!(width > 0) || !(height > 0)) return "unknown";
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.12) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(ratio - 4 / 5) < 0.08) return "4:5";
  if (Math.abs(ratio - 1) < 0.08) return "1:1";
  return `${width}:${height}`;
}

function reviewPublishDate(record) {
  if (record.campaign_published_at) return record.campaign_published_at;
  if (record.source_site === "best_ads") return record.source_uploaded_at || null;
  return null;
}

function reviewEligibility(record, asset, manifest = null) {
  if (!String(record.primary_brand || "").trim() || !(record.brands || []).includes(record.primary_brand)) return "primary_brand_required";
  const preReview = asset.ai_visual_pre_review || record.ai_visual_pre_review || null;
  if (preReview?.status !== "completed") return "completed_visual_pre_review_required";
  if (Number(preReview.frames_reviewed) !== 10) return "exactly_10_reviewed_frames_required";
  const sheet = manifest?.status === "ok" ? manifest.contact_sheet : asset.contact_sheet_path;
  const hasPlayback = asset.provider === "youtube" || asset.provider === "vimeo" || Boolean(asset.playback_url);
  if (!hasPlayback && !sheet) return "playback_or_contact_sheet_required";
  return null;
}

function eligibilitySelfTest() {
  const validRecord = {
    primary_brand: "Example Brand",
    brands: ["Example Brand"],
    ai_visual_pre_review: null,
  };
  const validAsset = {
    provider: "mp4",
    playback_url: "https://example.com/video.mp4",
    contact_sheet_path: "collect/runs/example.jpg",
    ai_visual_pre_review: { status: "completed", frames_reviewed: 10 },
  };
  const cases = [
    ["missing_brand", (record) => { record.primary_brand = null; }, "primary_brand_required"],
    ["missing_visual_review", (_record, asset) => { asset.ai_visual_pre_review = null; }, "completed_visual_pre_review_required"],
    ["nine_frames", (_record, asset) => { asset.ai_visual_pre_review.frames_reviewed = 9; }, "exactly_10_reviewed_frames_required"],
    ["no_playback_or_sheet", (_record, asset) => { asset.playback_url = null; asset.contact_sheet_path = null; }, "playback_or_contact_sheet_required"],
  ].map(([name, mutate, expected]) => {
    const redRecord = structuredClone(validRecord);
    const redAsset = structuredClone(validAsset);
    mutate(redRecord, redAsset);
    const red = reviewEligibility(redRecord, redAsset);
    const green = reviewEligibility(validRecord, validAsset);
    return { case: name, red: { ok: red === null, reason: red }, green: { ok: green === null }, passed: red === expected && green === null };
  });
  const publishDateMapping = [
    {
      case: "best_ads_source_uploaded_fallback",
      actual: reviewPublishDate({ source_site: "best_ads", campaign_published_at: null, source_uploaded_at: "2026-07-28T00:00:00.000Z" }),
      expected: "2026-07-28T00:00:00.000Z",
    },
    {
      case: "campaign_date_wins",
      actual: reviewPublishDate({ source_site: "best_ads", campaign_published_at: "2026-07-01T00:00:00.000Z", source_uploaded_at: "2026-07-28T00:00:00.000Z" }),
      expected: "2026-07-01T00:00:00.000Z",
    },
    {
      case: "aotw_does_not_use_source_uploaded_fallback",
      actual: reviewPublishDate({ source_site: "ads_of_the_world", campaign_published_at: null, source_uploaded_at: "2026-07-28T00:00:00.000Z" }),
      expected: null,
    },
  ].map((item) => ({ ...item, passed: item.actual === item.expected }));
  return {
    ok: cases.every((item) => item.passed) && publishDateMapping.every((item) => item.passed),
    red_to_green: cases,
    publish_date_mapping: publishDateMapping,
  };
}

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
    throw new Error("Fresh backup required before source import. Run: cd web && npm run backup:data");
  }
  return path.relative(repoRoot, latest.filePath);
}

async function loadManifestIndex(files) {
  const index = new Map();
  for (const file of files) {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    for (const item of payload.records || []) {
      if (!item.source_site || !item.source_record_id || !item.asset_id) continue;
      index.set(`${item.source_site}:${item.source_record_id}:${item.asset_id}`, item);
    }
  }
  return index;
}

function reviewItem(record, asset, manifest, importedFrom) {
  const mediaProvider = asset.provider;
  const videoId = safeId(sourceKey(record, asset));
  const youtubeId = mediaProvider === "youtube" ? asset.source_asset_id || asset.asset_id : null;
  const sheet = manifest?.status === "ok" ? manifest.contact_sheet : asset.contact_sheet_path;
  const durationSeconds = manifest?.duration_seconds ?? asset.duration_seconds ?? null;
  const width = manifest?.width ?? asset.width ?? null;
  const height = manifest?.height ?? asset.height ?? null;
  const candidate = record.classification_candidate || {};
  const preReview = asset.ai_visual_pre_review || record.ai_visual_pre_review || null;
  const visualProductCandidates = preReview?.product_category_candidates || [];
  const visualProductCategory = visualProductCandidates[0]?.category || null;
  const genreDefaults = genreDefaultsFromCandidates(preReview?.genre_candidates || []);
  const publishDate = reviewPublishDate(record);
  const pendingMetadata = !publishDate || !durationSeconds;
  const statusIds = unique(["pending_review", pendingMetadata ? "metadata_missing" : null]);
  const playbackUrl = asset.playback_url || null;
  const embedUrl = youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : mediaProvider === "vimeo" ? playbackUrl : null;
  const originalUrl = asset.original_url || null;
  const titleSuffix = asset.title && asset.title !== record.campaign_title ? ` — ${asset.title}` : "";
  return {
    id: videoId,
    video_id: videoId,
    url: originalUrl || record.source_detail_url,
    embed_url: embedUrl,
    playback_url: playbackUrl,
    original_media_url: originalUrl,
    thumbnail_url: asset.thumbnail_url || null,
    contact_sheet: contactSheetPath(sheet),
    title: `${record.campaign_title || "Untitled Campaign"}${titleSuffix}`,
    campaign_title: record.campaign_title || "",
    campaign_id: record.campaign_id || `${record.source_site}:${record.source_record_id}`,
    brand: record.primary_brand || "",
    primary_brand: record.primary_brand || "",
    brands: record.brands || [],
    industry: candidate.industry || null,
    industry_candidate: preReview?.industry_candidate || candidate.industry || null,
    product_category: candidate.product_category || null,
    product_category_candidate: visualProductCategory || candidate.product_category || null,
    product_category_candidates: visualProductCandidates,
    classification_candidate: candidate,
    genres: genreDefaults.genres,
    primary_genre: genreDefaults.primary_genre,
    secondary_genres: genreDefaults.secondary_genres,
    genre_candidates: preReview?.genre_candidates || [],
    source_type: record.source_site === "best_ads" ? "Best Ads" : "Ads of the World",
    source_site: record.source_site,
    source_platform: record.source_site,
    source_record_id: record.source_record_id,
    source_post_id: asset.source_asset_id || asset.asset_id,
    source_detail_url: record.source_detail_url,
    source_categories: record.source_categories || [],
    source_industries: record.source_industries || [],
    source_medium_types: record.source_medium_types || [],
    source_refs: record.source_refs || [],
    media_provider: mediaProvider,
    media_asset_id: asset.asset_id,
    media_access_status: asset.access_status,
    media_checked_at: asset.checked_at,
    media_expires_at: asset.expires_at,
    media_failure_reason: manifest?.error || asset.failure_reason || null,
    media_assets: [asset],
    platform_format: (record.source_medium_types || []).join(" / "),
    normalized_url: originalUrl || record.source_detail_url,
    width,
    height,
    aspect_ratio: aspectRatio({ ...asset, width, height }),
    is_vertical: ["9:16", "4:5"].includes(aspectRatio({ ...asset, width, height })),
    duration_seconds: durationSeconds,
    publish_date: publishDate,
    campaign_published_at: record.campaign_published_at,
    source_uploaded_at: record.source_uploaded_at,
    publish_date_source: record.publish_date_source,
    publish_date_confidence: record.publish_date_confidence,
    campaign_year_status: record.campaign_year_status,
    country: record.country,
    agency: record.agency,
    production_companies: record.production_companies || [],
    description: record.description || "",
    collected_at: record.collected_at,
    canonical_master_id: asset.canonical_master_id || record.canonical_master_id || `${record.source_site}:${asset.source_asset_id || asset.asset_id}`,
    canonical_match: asset.canonical_match || null,
    master_relations: asset.master_relations || [],
    review_status: "pending_review",
    visual_review_status: preReview?.status || "pending",
    ai_visual_pre_review: preReview,
    content_nature: preReview?.content_nature_candidate || "candidate_pending_review",
    ai_generation_value: preReview?.template_value?.reason || "",
    ai_template_fit: false,
    approved: false,
    core_template_eligible: false,
    frames_reviewed: preReview?.frames_reviewed || (sheet ? 10 : null),
    blacklisted: false,
    status_ids: statusIds,
    review_events: [],
    reason_codes: unique(preReview?.exclusion_candidates || []),
    decision_reason_codes: [],
    note: "AI 视觉预审题材已作为默认值写入；记录仍为待审核，需人工确认或纠正，批准状态不会自动变化。",
    visual_notes: preReview?.summary || "",
    imported_from: importedFrom,
    collection_batch: importedFrom,
    updated_at: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  const summary = eligibilitySelfTest();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
  process.exit(0);
}
const statePayload = await fs.readFile(statePath, "utf8");
const state = JSON.parse(statePayload);
const taxonomy = JSON.parse(await fs.readFile(taxonomyPath, "utf8"));
const manifestIndex = await loadManifestIndex(args.manifests);
const existingSourceKeys = new Set((state.videos || []).map((video) =>
  video.source_site && video.source_record_id && video.media_asset_id
    ? `${video.source_site}:${video.source_record_id}:${video.media_asset_id}`
    : null
).filter(Boolean));
const existingIds = new Set((state.videos || []).map((video) => video.video_id || video.id));
const added = [];
const skipped = [];
const validation = [];

for (const file of args.files) {
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  const records = recordsFrom(payload);
  const result = validateSourceBatch(records);
  validation.push({ file: path.relative(repoRoot, file), ...result });
  if (!result.ok) {
    const preview = result.results.filter((item) => !item.ok).slice(0, 5).map((item) => ({ source_key: item.source_key, errors: item.errors }));
    throw new Error(`Source record validation failed: ${JSON.stringify(preview)}`);
  }
  const importedFrom = path.relative(repoRoot, file);
  for (const record of records) {
    for (const asset of (record.media_assets || []).filter((item) => item.media_type === "video")) {
      const key = sourceKey(record, asset);
      const manifest = manifestIndex.get(`${record.source_site}:${record.source_record_id}:${asset.asset_id}`);
      const ineligibleReason = reviewEligibility(record, asset, manifest);
      if (ineligibleReason) {
        skipped.push({ source_key: key, reason: ineligibleReason });
        continue;
      }
      const item = reviewItem(record, asset, manifest, importedFrom);
      if (existingSourceKeys.has(key) || existingIds.has(item.video_id) || added.some((video) => video.video_id === item.video_id)) {
        skipped.push({ source_key: key, reason: "duplicate_existing_review_item" });
        continue;
      }
      added.push(item);
      existingSourceKeys.add(key);
      existingIds.add(item.video_id);
    }
  }
}

const currentIndustries = new Set((state.industries || []).map((item) => item.industry));
const currentCategories = new Set((state.categories || []).map((item) => `${item.industry}::${item.category}`));
const industriesToAdd = (taxonomy.industries || []).filter((item) => !currentIndustries.has(item.industry));
const categoriesToAdd = (taxonomy.industries || []).flatMap((industry) =>
  (industry.categories || []).map((category) => ({ industry: industry.industry, ...category }))
).filter((item) => !currentCategories.has(`${item.industry}::${item.category}`));
let backup = null;

if (!args.dryRun && added.length) {
  backup = await requireFreshBackup();
  state.industries.push(...industriesToAdd.map(({ industry, zh }) => ({ industry, zh, priority: "P1" })));
  state.categories.push(...categoriesToAdd);
  state.videos.push(...added);
  state.source_files = unique([...(state.source_files || []), ...args.files.map((file) => path.relative(repoRoot, file))]);
  state.updated_at = new Date().toISOString();
  state.videos.sort((left, right) => String(left.industry || "").localeCompare(String(right.industry || "")) || String(left.product_category || "").localeCompare(String(right.product_category || "")) || String(left.title || "").localeCompare(String(right.title || "")));
  const temporaryPath = `${statePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, statePath);
}

console.log(JSON.stringify({
  ok: true,
  dry_run: args.dryRun,
  files: args.files.map((file) => path.relative(repoRoot, file)),
  backup,
  campaigns: validation.reduce((total, item) => total + item.records, 0),
  validation: validation.map((item) => ({ file: item.file, ok: item.ok, importable: item.importable, pending: item.pending, invalid: item.invalid })),
  review_items_added: added.length,
  formal_genres_written: added.reduce((total, item) => total + item.genres.length, 0),
  providers: [...new Set(added.map((item) => item.media_provider))],
  skipped: skipped.length,
  skipped_preview: skipped.slice(0, 10),
  taxonomy_industries_to_add: industriesToAdd.map((item) => item.industry),
  taxonomy_categories_to_add: categoriesToAdd.length,
}, null, 2));
