import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const state = JSON.parse(await fs.readFile(dataPath, "utf8"));
const errors = [];
const warnings = [];

if (!Array.isArray(state.videos)) errors.push("state.videos must be an array");
if (!Array.isArray(state.statuses)) errors.push("state.statuses must be an array");
if (!Array.isArray(state.review_events)) warnings.push("state.review_events is missing or not an array");

const statuses = new Set((state.statuses || []).map((status) => status.id));
const videoIds = new Set();
const duplicateVideoIds = [];
const invalidStatusRefs = [];
const missingMetadataVideos = [];
const missingMetadataWithoutStatus = [];
const completeMetadataWithStatus = [];
const metadataFetchErrors = [];
const sourceKeys = new Set();
const duplicateSourceKeys = [];
const canonicalMasterCounts = new Map();
const categoryKeys = new Set((state.categories || []).map((item) => `${item.industry || ""}::${item.category}`));
const unknownCategoryRefs = [];

for (const video of state.videos || []) {
  const id = video.video_id || video.id;
  if (!id) {
    errors.push(`video without video_id: ${video.title || "untitled"}`);
    continue;
  }
  if (videoIds.has(id)) duplicateVideoIds.push(id);
  videoIds.add(id);

  const platform = video.source_platform || (/youtu(?:\.be|be\.com)/i.test(video.url || "") ? "youtube" : null);
  const postId = video.source_post_id || (platform === "youtube" ? id : null);
  if (platform && postId) {
    const sourceKey = `${platform}:${postId}`;
    if (sourceKeys.has(sourceKey)) duplicateSourceKeys.push(sourceKey);
    sourceKeys.add(sourceKey);
  }
  if (video.canonical_master_id) {
    canonicalMasterCounts.set(video.canonical_master_id, (canonicalMasterCounts.get(video.canonical_master_id) || 0) + 1);
  }
  const categoryKey = `${video.industry || ""}::${video.product_category}`;
  if (video.product_category && !categoryKeys.has(categoryKey)) unknownCategoryRefs.push(`${id}:${categoryKey}`);

  for (const statusId of video.status_ids || []) {
    if (!statuses.has(statusId)) invalidStatusRefs.push(`${id}:${statusId}`);
  }

  if (!video.publish_date || !video.duration_seconds) {
    missingMetadataVideos.push(id);
    if (!(video.status_ids || []).includes("metadata_missing")) missingMetadataWithoutStatus.push(id);
    if (video.metadata_error) metadataFetchErrors.push(id);
  } else if ((video.status_ids || []).includes("metadata_missing")) {
    completeMetadataWithStatus.push(id);
  }
}

if (duplicateVideoIds.length) errors.push(`duplicate video ids: ${duplicateVideoIds.slice(0, 10).join(", ")}`);
if (duplicateSourceKeys.length) errors.push(`duplicate source keys: ${duplicateSourceKeys.slice(0, 10).join(", ")}`);
if (invalidStatusRefs.length) errors.push(`invalid status refs: ${invalidStatusRefs.slice(0, 10).join(", ")}`);
if (unknownCategoryRefs.length) warnings.push(`videos reference unregistered industry/category: ${unknownCategoryRefs.slice(0, 10).join(", ")}`);
if (missingMetadataWithoutStatus.length) warnings.push(`missing metadata without metadata_missing status: ${missingMetadataWithoutStatus.length}`);
if (completeMetadataWithStatus.length) warnings.push(`complete metadata still tagged metadata_missing: ${completeMetadataWithStatus.length}`);
const duplicateCanonicalMasters = [...canonicalMasterCounts.entries()].filter(([, count]) => count > 1);
if (duplicateCanonicalMasters.length) warnings.push(`duplicate canonical masters in historical data: ${duplicateCanonicalMasters.length}`);

const reviewEvents = state.review_events || [];
const orphanEvents = reviewEvents.filter((event) => !videoIds.has(event.video_id)).map((event) => event.id || event.video_id);
if (orphanEvents.length) errors.push(`review events reference missing videos: ${orphanEvents.slice(0, 10).join(", ")}`);

const pollutedBlacklistEvents = [];
for (const event of reviewEvents) {
  if (
    event.action === "blacklist" &&
    event.before?.blacklisted === false &&
    Array.isArray(event.before.status_ids) &&
    event.before.status_ids.includes("blacklisted")
  ) {
    pollutedBlacklistEvents.push(event.id || event.video_id);
  }
}
if (pollutedBlacklistEvents.length) warnings.push(`blacklist before snapshots look polluted: ${pollutedBlacklistEvents.length}`);

const summary = {
  ok: errors.length === 0,
  videos: (state.videos || []).length,
  statuses: (state.statuses || []).length,
  review_events: reviewEvents.length,
  missing_metadata: missingMetadataVideos.length,
  missing_metadata_without_status: missingMetadataWithoutStatus.length,
  complete_metadata_with_status: completeMetadataWithStatus.length,
  metadata_fetch_errors: metadataFetchErrors.length,
  duplicate_source_keys: duplicateSourceKeys.length,
  duplicate_canonical_masters: duplicateCanonicalMasters.length,
  errors,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
