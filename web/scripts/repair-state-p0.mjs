import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const state = JSON.parse(await fs.readFile(dataPath, "utf8"));

const metadataStatus = {
  id: "metadata_missing",
  name: "待补元数据",
  color: "#a78bfa",
  is_system: true,
  sort_order: 5,
};

let statusesAdded = 0;
let videosTagged = 0;
let videosUntagged = 0;
let eventsRepaired = 0;

if (!state.statuses.some((status) => status.id === metadataStatus.id)) {
  state.statuses.push(metadataStatus);
  statusesAdded += 1;
}

state.statuses = state.statuses.map((status) => {
  if (status.id === "approved") return { ...status, sort_order: 6 };
  if (status.id === "excluded") return { ...status, sort_order: 7 };
  if (status.id === "blacklisted") return { ...status, sort_order: 8 };
  return status.id === metadataStatus.id ? { ...metadataStatus, ...status, is_system: true } : status;
}).sort((left, right) => (left.sort_order || 999) - (right.sort_order || 999));

for (const video of state.videos || []) {
  video.status_ids = video.status_ids || [];
  if ((!video.publish_date || !video.duration_seconds) && !video.status_ids.includes(metadataStatus.id)) {
    video.status_ids.push(metadataStatus.id);
    videosTagged += 1;
  }
  if (video.publish_date && video.duration_seconds && video.status_ids.includes(metadataStatus.id)) {
    video.status_ids = video.status_ids.filter((id) => id !== metadataStatus.id);
    videosUntagged += 1;
  }
}

function repairEvent(event) {
  if (
    event?.action === "blacklist" &&
    event.before?.blacklisted === false &&
    Array.isArray(event.before.status_ids) &&
    event.before.status_ids.includes("blacklisted")
  ) {
    event.before.status_ids = event.before.status_ids.filter((id) => id !== "blacklisted");
    eventsRepaired += 1;
  }
  if (
    event?.action === "unblacklist" &&
    event.before?.blacklisted === true &&
    Array.isArray(event.before.status_ids) &&
    !event.before.status_ids.includes("blacklisted")
  ) {
    event.before.status_ids.push("blacklisted");
    eventsRepaired += 1;
  }
}

for (const event of state.review_events || []) repairEvent(event);
for (const video of state.videos || []) {
  for (const event of video.review_events || []) repairEvent(event);
}

state.updated_at = new Date().toISOString();
await fs.writeFile(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ok: true, statusesAdded, videosTagged, videosUntagged, eventsRepaired }, null, 2));
