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

for (const video of state.videos || []) {
  const id = video.video_id || video.id;
  if (!id) {
    errors.push(`video without video_id: ${video.title || "untitled"}`);
    continue;
  }
  if (videoIds.has(id)) duplicateVideoIds.push(id);
  videoIds.add(id);

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
if (invalidStatusRefs.length) errors.push(`invalid status refs: ${invalidStatusRefs.slice(0, 10).join(", ")}`);
if (missingMetadataWithoutStatus.length) warnings.push(`missing metadata without metadata_missing status: ${missingMetadataWithoutStatus.length}`);
if (completeMetadataWithStatus.length) warnings.push(`complete metadata still tagged metadata_missing: ${completeMetadataWithStatus.length}`);

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
  errors,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exit(1);
