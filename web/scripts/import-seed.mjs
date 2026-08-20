import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(webRoot, "..");
const collectRoot = path.join(repoRoot, "collect");
const outputPath = path.join(webRoot, "data", "creative-library-state.json");
const reset = process.argv.includes("--reset");

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function videoIdFromUrl(url = "") {
  return (
    url.match(/[?&]v=([^&]+)/)?.[1] ||
    url.match(/youtu\.be\/([^?]+)/)?.[1] ||
    url.match(/youtube\.com\/shorts\/([^?]+)/)?.[1] ||
    null
  );
}

function toMediaPath(absOrRelative) {
  if (!absOrRelative) return null;
  const absolute = path.isAbsolute(absOrRelative) ? absOrRelative : path.join(repoRoot, absOrRelative);
  if (!absolute.startsWith(collectRoot)) return null;
  return `/media/${path.relative(repoRoot, absolute).split(path.sep).join("/")}`;
}

async function contactSheetMap() {
  const manifests = [
    "collect/mvp-contact-sheets-v1/manifest.json",
    "collect/mvp-gap-contact-sheets-v1-multi-unbox/manifest.json",
    "collect/mvp-gap-contact-sheets-v1-pb-hard-genres/manifest.json",
    "collect/mvp-gap-contact-sheets-v1-earbuds-hard-genres/manifest.json",
    "collect/mvp-gap-contact-sheets-v1-earbuds-multi-unbox-tail/manifest.json",
    "collect/mvp-gap-contact-sheets-v1-earbuds-hard-genres-tail/manifest.json",
  ];
  const map = new Map();
  for (const manifest of manifests) {
    const fullPath = path.join(repoRoot, manifest);
    if (!fssync.existsSync(fullPath)) continue;
    const payload = JSON.parse(await fs.readFile(fullPath, "utf8"));
    for (const record of payload.records || []) {
      const sheetPath = record.contact_sheet || record.sheet_path || record.output_path;
      if (record.video_id && sheetPath) map.set(record.video_id, toMediaPath(sheetPath));
    }
  }
  return map;
}

function statusIdsFor(video) {
  const ids = [];
  if (video.blacklisted) ids.push("blacklisted");
  else if (video.review_status === "rejected") ids.push("excluded");
  else if (video.review_status === "accepted" || video.core_template_eligible) ids.push("approved");
  else ids.push("pending_review");
  if (!video.publish_date || !video.duration_seconds) ids.push("metadata_missing");
  return [...new Set(ids)];
}

function normalizeVideo(source, reviewRecord, contactSheet) {
  const videoId = source.video_id || reviewRecord?.video_id || videoIdFromUrl(source.url);
  const reviewStatus = reviewRecord?.status || source.status || (source.core_template_eligible ? "accepted" : "imported");
  const blacklisted = false;
  const genres = reviewRecord?.genres || source.genres || [];
  const primaryGenre = reviewRecord?.primary_genre ?? source.primary_genre ?? genres[0] ?? null;
  const secondaryGenres = reviewRecord?.secondary_genres || source.secondary_genres || genres.filter((genre) => genre !== primaryGenre);
  const video = {
    id: videoId,
    video_id: videoId,
    url: source.url || reviewRecord?.url || `https://www.youtube.com/watch?v=${videoId}`,
    embed_url: `https://www.youtube.com/embed/${videoId}`,
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    contact_sheet: contactSheet || null,
    title: reviewRecord?.title || source.title || "",
    brand: reviewRecord?.brand || source.brand || "",
    industry: source.industry || "Consumer Electronics",
    product_category: reviewRecord?.product_category || source.product_category || "Unclassified",
    genres,
    primary_genre: primaryGenre,
    secondary_genres: secondaryGenres,
    source_type: reviewRecord?.source_type || source.source_type || "",
    source_platform: reviewRecord?.source_platform || source.source_platform || "youtube",
    source_post_id: reviewRecord?.source_post_id || source.source_post_id || videoId,
    platform_format: reviewRecord?.platform_format || source.platform_format || "",
    source_account: reviewRecord?.source_account || source.source_account || "",
    source_account_id: reviewRecord?.source_account_id || source.source_account_id || "",
    source_account_type: reviewRecord?.source_account_type || source.source_account_type || "",
    normalized_url: reviewRecord?.normalized_url || source.normalized_url || `https://www.youtube.com/watch?v=${videoId}`,
    width: reviewRecord?.width ?? source.width ?? null,
    height: reviewRecord?.height ?? source.height ?? null,
    aspect_ratio: reviewRecord?.aspect_ratio || source.aspect_ratio || "unknown",
    is_vertical: Boolean(reviewRecord?.is_vertical ?? source.is_vertical),
    is_paid_ad: Boolean(reviewRecord?.is_paid_ad ?? source.is_paid_ad),
    view_count: reviewRecord?.view_count ?? source.view_count ?? null,
    published_at: reviewRecord?.published_at || source.published_at || null,
    collected_at: reviewRecord?.collected_at || source.collected_at || null,
    collection_rule_version: reviewRecord?.collection_rule_version || source.collection_rule_version || "",
    note: reviewRecord?.visual_notes || source.note || "",
    visual_notes: reviewRecord?.visual_notes || source.note || "",
    reason_codes: reviewRecord?.reason_codes || [],
    decision_reason_codes: reviewRecord?.decision_reason_codes || [],
    duration_seconds: reviewRecord?.duration_seconds || source.duration_seconds || null,
    publish_date: reviewRecord?.publish_date || source.publish_date || null,
    canonical_master_id: reviewRecord?.canonical_master_id || source.canonical_master_id || videoId,
    review_status: reviewStatus,
    publisher_role: reviewRecord?.publisher_role || "",
    content_nature: reviewRecord?.content_nature || "",
    recency_status: reviewRecord?.recency_status || "",
    ai_generation_value: reviewRecord?.ai_generation_value || "",
    ai_template_fit: Boolean(reviewRecord?.ai_template_fit ?? source.ai_template_fit ?? source.core_template_eligible),
    core_template_eligible: Boolean(reviewRecord?.core_template_eligible ?? source.core_template_eligible ?? reviewStatus === "accepted"),
    frames_reviewed: reviewRecord?.frames_reviewed ?? null,
    blacklisted,
    status_ids: [],
    review_events: [],
    imported_from: reviewRecord ? "consumer-electronics-review-v5" : "library-v9",
    updated_at: null,
  };
  video.status_ids = statusIdsFor(video);
  return video;
}

if (fssync.existsSync(outputPath) && !reset) {
  console.log(`Data already exists: ${outputPath}`);
  console.log("Run npm run reset:data to regenerate from collect/*.json.");
  process.exit(0);
}

const [library, review, genreData, taxonomyData, stats, methodologyMain, methodologyCe, sourceCollectionMethodology] = await Promise.all([
  readJson("collect/library-v9.json"),
  readJson("collect/consumer-electronics-review-v5.json"),
  readJson("collect/ad-video-genres-v1.json"),
  readJson("collect/consumer-electronics-taxonomy-v1.json"),
  readJson("collect/stats-v9.json"),
  readText("collect/采集方案与优质判定标准.md"),
  readText("collect/采集方案与优质判定标准-v2.md"),
  readJson("collect/source-collection-methodology-v1.json"),
]);

let petTaxonomyData = { categories: [] };
try {
  petTaxonomyData = await readJson("collect/pet-supplies-taxonomy-v1.json");
} catch {
  petTaxonomyData = { categories: [] };
}

let sportingTaxonomyData = { categories: [] };
try {
  sportingTaxonomyData = await readJson("collect/sporting-goods-fitness-taxonomy-v1.json");
} catch {
  sportingTaxonomyData = { categories: [] };
}

let brandTaxonomyData = { industries: [] };
try {
  brandTaxonomyData = await readJson("collect/adgenie-brand-taxonomy-v1.json");
} catch {
  brandTaxonomyData = { industries: [] };
}

const contacts = await contactSheetMap();
const reviewByVideoId = new Map(review.records.map((record) => [record.video_id, record]));
const videoMap = new Map();

for (const item of library.videos) {
  const id = item.video_id || videoIdFromUrl(item.url);
  if (!id) continue;
  videoMap.set(id, normalizeVideo(item, reviewByVideoId.get(id), contacts.get(id)));
}

for (const record of review.records) {
  const id = record.video_id;
  if (!id || videoMap.has(id)) continue;
  videoMap.set(id, normalizeVideo(record, record, contacts.get(id)));
}

const statuses = [
  { id: "pending_review", name: "待审核", color: "#f59e0b", is_system: true, sort_order: 1 },
  { id: "needs_remake", name: "需复刻", color: "#38bdf8", is_system: true, sort_order: 2 },
  { id: "remade", name: "已复刻", color: "#22c55e", is_system: true, sort_order: 3 },
  { id: "parked", name: "暂搁置", color: "#94a3b8", is_system: true, sort_order: 4 },
  { id: "metadata_missing", name: "待补元数据", color: "#a78bfa", is_system: true, sort_order: 5 },
  { id: "approved", name: "已入库", color: "#10b981", is_system: true, sort_order: 6 },
  { id: "excluded", name: "已排除", color: "#fb7185", is_system: true, sort_order: 7 },
  { id: "blacklisted", name: "已拉黑", color: "#ef4444", is_system: true, sort_order: 8 },
];

const state = {
  version: 1,
  generated_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  source_files: [
    "collect/library-v9.json",
    "collect/consumer-electronics-review-v5.json",
    "collect/ad-video-genres-v1.json",
    "collect/consumer-electronics-taxonomy-v1.json",
    "collect/stats-v9.json",
    "collect/source-collection-methodology-v1.json",
  ],
  stats,
  statuses,
  genres: genreData.genres,
  genre_groups: genreData.groups,
  target_genres: stats.consumer_electronics.target_genres,
  target_genres_by_industry: {
    "Consumer Electronics": stats.consumer_electronics.target_genres,
    "Pet Supplies": [
      "TVC / Brand Commercial",
      "Concept Film / Brand Manifesto",
      "Story-Driven Product Ad",
      "Problem–Solution",
      "Product Demo",
      "Feature Callout",
      "Before & After",
      "Daily Routine",
      "UGC Ad",
      "Testimonial / Review",
      "Macro Close-Up",
      "Unboxing",
      "How-To Tutorial",
      "Try-On / Try-Out",
    ],
    "Sporting Goods & Fitness": [
      "TVC / Brand Commercial",
      "Concept Film / Brand Manifesto",
      "Story-Driven Product Ad",
      "Sports Hero Film",
      "Product Demo",
      "Feature Callout",
      "Problem–Solution",
      "Daily Routine",
      "UGC Ad",
      "Testimonial / Review",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
      "Try-On / Try-Out",
    ],
  },
  industries: [
    { industry: "Consumer Electronics", zh: "消费电子", priority: "P0" },
    { industry: "Pet Supplies", zh: "宠物用品", priority: "P1" },
    { industry: "Sporting Goods & Fitness", zh: "运动健身", priority: "P1" },
    ...brandTaxonomyData.industries.map(({ industry, zh }) => ({ industry, zh, priority: "P1" })),
  ],
  categories: [
    ...taxonomyData.categories.map((item) => ({ industry: "Consumer Electronics", ...item })),
    ...petTaxonomyData.categories.map((item) => ({ industry: "Pet Supplies", ...item })),
    ...sportingTaxonomyData.categories.map((item) => ({ industry: "Sporting Goods & Fitness", ...item })),
    ...brandTaxonomyData.industries.flatMap((industry) => industry.categories.map((item) => ({ industry: industry.industry, ...item }))),
  ],
  priority_categories: stats.consumer_electronics.priority_categories,
  priority_categories_by_industry: {
    "Consumer Electronics": stats.consumer_electronics.priority_categories,
    "Pet Supplies": petTaxonomyData.categories.filter((item) => item.priority === "P0").map((item) => item.category),
    "Sporting Goods & Fitness": sportingTaxonomyData.categories.filter((item) => item.priority === "P0").map((item) => item.category),
  },
  videos: [...videoMap.values()].sort((left, right) => {
    const category = String(left.product_category).localeCompare(String(right.product_category));
    if (category !== 0) return category;
    return String(left.title).localeCompare(String(right.title));
  }),
  review_events: [],
  methodology: {
    version: review.criteria?.methodology_version || "v3",
    review_version: review.version,
    main_doc_path: "collect/采集方案与优质判定标准.md",
    ce_doc_path: "collect/采集方案与优质判定标准-v2.md",
    main_doc: methodologyMain,
    ce_doc: methodologyCe,
    source_collection: sourceCollectionMethodology,
    automation_note: "方法论沉淀第一版只记录人工原因和规则线索，不自动改规则；后续由 Codex 分析后再更新。",
  },
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: outputPath,
      videos: state.videos.length,
      genres: state.genres.length,
      categories: state.categories.length,
      statuses: state.statuses.length,
    },
    null,
    2,
  ),
);
