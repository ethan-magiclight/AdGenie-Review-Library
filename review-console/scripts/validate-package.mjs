import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.basename(path.dirname(scriptDir)) === "review-console"
  ? path.join(path.dirname(scriptDir), "release")
  : path.dirname(scriptDir);
const statePath = path.join(packageRoot, "web/data/creative-library-state.json");
const manifestPath = path.join(packageRoot, "manifest.json");
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function remoteVideoReference(video) {
  return [video.playback_url, video.original_media_url, video.embed_url, video.url]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
}

async function walkFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const stateContent = await fs.readFile(statePath);
const state = JSON.parse(stateContent);
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const stateHash = crypto.createHash("sha256").update(stateContent).digest("hex");

assert(stateHash === manifest.state_sha256, "Packaged state hash does not match manifest");
assert(state.videos.length === manifest.counts.videos, "Video count does not match manifest");
assert((state.review_events?.length || 0) === manifest.counts.review_events, "Review event count does not match manifest");

const missingLinks = state.videos.filter((video) => !remoteVideoReference(video));
assert(missingLinks.length === 0, `Videos without remote links: ${missingLinks.length}`);

const missingSourceFiles = [];
for (const relativePath of manifest.source_files) {
  try {
    await fs.access(path.join(packageRoot, relativePath));
  } catch {
    missingSourceFiles.push(relativePath);
  }
}
assert(missingSourceFiles.length === 0, `Missing source files: ${missingSourceFiles.join(", ")}`);

const missingContactSheets = [];
for (const relativePath of manifest.contact_sheets) {
  try {
    await fs.access(path.join(packageRoot, relativePath));
  } catch {
    missingContactSheets.push(relativePath);
  }
}
assert(missingContactSheets.length === 0, `Missing contact sheets: ${missingContactSheets.length}`);

const packagedFiles = await walkFiles(packageRoot);
const localVideos = packagedFiles.filter((filePath) => videoExtensions.has(path.extname(filePath).toLowerCase()));
assert(localVideos.length === 0, `Local video files are forbidden: ${localVideos.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  package_root: packageRoot,
  videos: state.videos.length,
  review_events: state.review_events?.length || 0,
  source_files: manifest.source_files.length,
  contact_sheets: manifest.contact_sheets.length,
  remote_video_references: state.videos.length,
  local_video_files: localVideos.length
}, null, 2));
