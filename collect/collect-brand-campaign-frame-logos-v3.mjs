#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { curlProxyArgs, inspectImage, normalizeLogo, resolveCurl, resolveFfmpeg } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const fallbacksPath = path.join(collectRoot, "brand-campaign-logo-fallbacks-v3.json");
const cropsPath = path.join(collectRoot, "brand-campaign-frame-crops-v3.json");
const outputRoot = path.join(collectRoot, "brand-assets-v3");
const registryPath = path.join(outputRoot, "registry.json");
const curlPath = resolveCurl();
const ffmpegPath = resolveFfmpeg();

function parseArgs(argv) {
  const options = { limit: Number.MAX_SAFE_INTEGER, brandIds: [], retry: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--brand") options.brandIds.push(argv[++index]);
    else if (argument === "--retry") options.retry = true;
    else if (argument === "--force") options.force = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function downloadVideo(url, destination) {
  execFileSync(curlPath, [
    ...curlProxyArgs(), "-L", "--http1.1", "--fail", "--silent", "--show-error",
    "--connect-timeout", "10", "--max-time", "600", "--retry", "2", "--retry-all-errors",
    "-H", "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    "-o", destination, url,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

function extractFrame(videoPath, seconds, outputPath) {
  execFileSync(ffmpegPath, ["-loglevel", "error", "-y", "-ss", String(seconds), "-i", videoPath, "-frames:v", "1", outputPath], { stdio: ["ignore", "pipe", "pipe"] });
}

function cropFrame(framePath, crop, background, sourcePath) {
  const filters = [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`];
  if (crop.rotate === "clockwise") filters.push("transpose=1");
  if (crop.rotate === "counterclockwise") filters.push("transpose=2");
  if (background?.color) filters.push(`colorkey=${background.color}:${background.similarity ?? 0.08}:${background.blend ?? 0.03}`, "format=rgba");
  execFileSync(ffmpegPath, ["-loglevel", "error", "-y", "-i", framePath, "-vf", filters.join(","), "-frames:v", "1", sourcePath], { stdio: ["ignore", "pipe", "pipe"] });
}

function writeRegistry(registry) {
  registry.summary = registry.brands.reduce((summary, record) => {
    summary.brand_count = registry.brands.length;
    summary[record.status] = (summary[record.status] ?? 0) + 1;
    return summary;
  }, {});
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

async function processBrand(fallback, cropInstruction) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adgenie-campaign-video-"));
  const videoPath = path.join(temporaryRoot, "campaign.mp4");
  const brandRoot = path.join(outputRoot, fallback.canonical_brand_id);
  const evidenceRoot = path.join(brandRoot, "evidence");
  const sourceRoot = path.join(brandRoot, "source");
  const normalizedRoot = path.join(brandRoot, "output");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  try {
    const frames = [];
    const requestedFrames = fallback.suggested_frame_seconds.map((seconds) => ({
      seconds,
      framePath: path.join(evidenceRoot, `frame-${String(seconds).replace(".", "_")}s.png`),
    }));
    if (!requestedFrames.every(({ framePath }) => fs.existsSync(framePath))) {
      downloadVideo(fallback.media_url, videoPath);
    }
    for (const { seconds, framePath } of requestedFrames) {
      if (!fs.existsSync(framePath)) extractFrame(videoPath, seconds, framePath);
      frames.push({ seconds, file: path.relative(outputRoot, framePath).split(path.sep).join("/"), sha256: sha256(fs.readFileSync(framePath)), ...await inspectImage(framePath) });
    }
    if (!cropInstruction?.crop || !Number.isFinite(cropInstruction.frame_seconds)) {
      return {
        canonical_brand_id: fallback.canonical_brand_id,
        status: "campaign_frame_collected_pending_crop_review",
        campaign_source: fallback,
        candidate_frames: frames,
        approved_for_product: false,
        permission_status: "campaign_asset_review_required",
      };
    }
    const selectedFrame = frames.find((frame) => frame.seconds === cropInstruction.frame_seconds);
    if (!selectedFrame) throw new Error("Selected frame is not present in suggested_frame_seconds");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(normalizedRoot, { recursive: true });
    const selectedFramePath = path.join(outputRoot, selectedFrame.file);
    const sourcePath = path.join(sourceRoot, `${fallback.canonical_brand_id}-campaign-derived.png`);
    const normalizedPath = path.join(normalizedRoot, `${fallback.canonical_brand_id}-icon@4x.png`);
    cropFrame(selectedFramePath, cropInstruction.crop, cropInstruction.background, sourcePath);
    await normalizeLogo(sourcePath, normalizedPath);
    const sourceBuffer = fs.readFileSync(sourcePath);
    const normalizedBuffer = fs.readFileSync(normalizedPath);
    return {
      canonical_brand_id: fallback.canonical_brand_id,
      status: "campaign_frame_derived_pending_approval",
      campaign_source: fallback,
      candidate_frames: frames,
      crop_instruction: cropInstruction,
      source: { file: path.relative(outputRoot, sourcePath).split(path.sep).join("/"), bytes: sourceBuffer.length, sha256: sha256(sourceBuffer), ...await inspectImage(sourcePath) },
      normalized: { file: path.relative(outputRoot, normalizedPath).split(path.sep).join("/"), mime: "image/png", bytes: normalizedBuffer.length, sha256: sha256(normalizedBuffer), ...await inspectImage(normalizedPath), intended_css_width: 56, intended_css_height: 56 },
      approved_for_product: false,
      permission_status: "campaign_asset_review_required",
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
const fallbacks = JSON.parse(fs.readFileSync(fallbacksPath, "utf8"));
const crops = JSON.parse(fs.readFileSync(cropsPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const cropById = new Map(crops.brands.map((record) => [record.canonical_brand_id, record]));
const selected = fallbacks.brands.filter((fallback) => {
  if (options.brandIds.length > 0 && !options.brandIds.includes(fallback.canonical_brand_id)) return false;
  const current = registry.brands.find((record) => record.canonical_brand_id === fallback.canonical_brand_id);
  return options.force || current?.status === "pending_campaign_frame_collection" || (options.retry && ["campaign_frame_network_retry_required", "campaign_frame_collected_pending_crop_review", "campaign_frame_derived_pending_approval"].includes(current?.status));
}).slice(0, options.limit);

for (let index = 0; index < selected.length; index += 1) {
  const fallback = selected[index];
  const registryIndex = registry.brands.findIndex((record) => record.canonical_brand_id === fallback.canonical_brand_id);
  try {
    const result = await processBrand(fallback, cropById.get(fallback.canonical_brand_id));
    registry.brands[registryIndex] = { ...registry.brands[registryIndex], ...result };
    console.log(`${index + 1}/${selected.length} ${fallback.canonical_brand_id}: ${result.status}`);
  } catch (error) {
    registry.brands[registryIndex].status = /curl|ssl|tls|timed?\s*out|connect/i.test(error.message)
      ? "campaign_frame_network_retry_required"
      : "campaign_frame_collection_needs_review";
    registry.brands[registryIndex].error = error.message;
    console.error(`${index + 1}/${selected.length} ${fallback.canonical_brand_id}: ${error.message.split("\n")[0]}`);
  }
  writeRegistry(registry);
}
writeRegistry(registry);
console.log(JSON.stringify(registry.summary, null, 2));
