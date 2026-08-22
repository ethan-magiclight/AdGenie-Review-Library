#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { today } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const allowIncomplete = process.argv.includes("--allow-incomplete");
const baseline = process.argv.includes("--baseline");
const supportedArguments = new Set(["--allow-incomplete", "--baseline"]);
for (const argument of process.argv.slice(2)) {
  if (!supportedArguments.has(argument)) throw new Error(`Unknown argument: ${argument}`);
}

const input = readJson("brand-normalization-input-v1.json");
const mapping = readJson("brand-normalization-map-v1.json");
const sites = readJson("brand-official-site-registry-v3.json");
const assets = readJson(path.join("brand-assets-v3", "registry.json"));
const errors = [];
const warnings = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(collectRoot, relativePath), "utf8"));
}

function uniqueCount(items, key) {
  return new Set(items.map((item) => item[key])).size;
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  if (header.length < 24 || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || header.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("not a valid PNG with an IHDR header");
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolvedPath(record, kind) {
  if (record[kind]?.file) return path.join("brand-assets-v3", record[kind].file);
  return record[`${kind}_file`] ?? null;
}

const inputVideos = Object.values(input.videos ?? {});
const inputVideoIds = new Set(inputVideos.map((video) => video.video_id || video.id));
const mappingVideoIds = new Set(mapping.video_mappings.map((record) => record.video_id));
const mappedIds = new Set(mapping.canonical_brands.map((brand) => brand.canonical_brand_id));
const siteIds = new Set(sites.brands.map((brand) => brand.canonical_brand_id));
const assetIds = new Set(assets.brands.map((brand) => brand.canonical_brand_id));

assert(input.video_count === inputVideos.length, "Input video_count does not match the videos object");
assert(mapping.summary.video_count === input.video_count, "Mapping video count does not match normalization input");
assert(mapping.video_mappings.length === input.video_count, "Not every review-console video has a mapping record");
assert(inputVideoIds.size === inputVideos.length, "Duplicate video IDs found in normalization input");
assert(mappingVideoIds.size === mapping.video_mappings.length, "Duplicate video mapping records found");
assert(sameSet(inputVideoIds, mappingVideoIds), "Video mapping IDs do not exactly match normalization input IDs");
assert(uniqueCount(mapping.canonical_brands, "canonical_brand_id") === mapping.canonical_brands.length, "Duplicate canonical brand IDs found");
assert(mapping.video_mappings.every((record) => record.mapping_status && Array.isArray(record.canonical_brands)), "Malformed video mapping found");
assert(mapping.video_mappings.filter((record) => record.mapping_status === "unresolved").length === 0, "Unresolved video mappings remain");
assert(mapping.video_mappings.every((record) => record.canonical_brands.every((brand) => mappedIds.has(brand.id))), "Video mapping references an unknown canonical brand ID");

const terminalIdentityStatuses = new Set([
  "verified_preexisting_registry",
  "verified_automated_evidence",
  "verified_direct_domain_evidence",
  "verified_manual_override",
  "verified_campaign_identity_no_official_site",
]);
assert(uniqueCount(sites.brands, "canonical_brand_id") === sites.brands.length, "Duplicate identity-source records found");
assert(sameSet(mappedIds, siteIds), "Identity-source brand IDs do not exactly match canonical mapping IDs");
assert(sites.brands.every((record) => terminalIdentityStatuses.has(record.status)), "Non-terminal identity-source status remains");

assert(uniqueCount(assets.brands, "canonical_brand_id") === assets.brands.length, "Duplicate asset records found");
assert(sameSet(mappedIds, assetIds), "Asset brand IDs do not exactly match canonical mapping IDs");

const incompleteStatuses = new Set([
  "pending_official_site",
  "pending_asset_collection",
  "pending_campaign_frame_collection",
  "campaign_frame_network_retry_required",
  "campaign_frame_collection_needs_review",
  "asset_collection_needs_review",
  "asset_collection_network_retry_required",
  "official_asset_collected_quality_upgrade_required",
  "campaign_frame_collected_pending_crop_review",
  "rendered_page_logo_needs_review",
]);

for (const record of assets.brands) {
  const sourceRelativePath = resolvedPath(record, "source");
  if (sourceRelativePath) {
    const sourcePath = path.resolve(collectRoot, sourceRelativePath);
    assert(sourcePath.startsWith(path.resolve(collectRoot, "brand-assets-v3") + path.sep), `${record.canonical_brand_id}: source path escapes brand-assets-v3`);
    assert(fs.existsSync(sourcePath), `${record.canonical_brand_id}: source file is missing: ${sourceRelativePath}`);
    if (fs.existsSync(sourcePath) && record.source?.sha256) assert(hash(sourcePath) === record.source.sha256, `${record.canonical_brand_id}: source SHA-256 mismatch`);
  }

  const normalizedRelativePath = resolvedPath(record, "normalized");
  if (!normalizedRelativePath) {
    if (!incompleteStatuses.has(record.status)) errors.push(`${record.canonical_brand_id}: terminal asset status has no normalized file`);
    continue;
  }
  const normalizedPath = path.resolve(collectRoot, normalizedRelativePath);
  assert(normalizedPath.startsWith(path.resolve(collectRoot, "brand-assets-v3") + path.sep), `${record.canonical_brand_id}: normalized path escapes brand-assets-v3`);
  assert(fs.existsSync(normalizedPath), `${record.canonical_brand_id}: normalized file is missing: ${normalizedRelativePath}`);
  if (!fs.existsSync(normalizedPath)) continue;
  try {
    const size = pngDimensions(normalizedPath);
    assert(size.width === 224 && size.height === 224, `${record.canonical_brand_id}: normalized PNG is ${size.width}x${size.height}, expected 224x224`);
  } catch (error) {
    errors.push(`${record.canonical_brand_id}: ${error.message}`);
  }
  if (record.normalized?.sha256) assert(hash(normalizedPath) === record.normalized.sha256, `${record.canonical_brand_id}: normalized SHA-256 mismatch`);
}

const incomplete = assets.brands.filter((record) => incompleteStatuses.has(record.status));
if (incomplete.length > 0) {
  const summary = Object.entries(incomplete.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] ?? 0) + 1;
    return counts;
  }, {})).map(([status, count]) => `${status}=${count}`).join(", ");
  const message = `Asset closure incomplete: ${summary}`;
  if (allowIncomplete) warnings.push(message); else errors.push(message);
}

if (baseline) {
  assert(input.video_count === 853, `Baseline expected 853 review-console videos, received ${input.video_count}`);
  assert(mapping.canonical_brands.length === 269, `Baseline expected 269 canonical brands, received ${mapping.canonical_brands.length}`);
  assert(sites.brands.filter((record) => record.status === "verified_campaign_identity_no_official_site").length === 6, "Baseline campaign-only identity count drifted from the reviewed six-brand exception set");
}

const report = {
  passed: errors.length === 0,
  allow_incomplete: allowIncomplete,
  baseline_checked: baseline,
  checked_at: today(),
  counts: {
    review_console_videos: input.video_count,
    video_mapping_records: mapping.video_mappings.length,
    canonical_brands: mapping.canonical_brands.length,
    identity_source_records: sites.brands.length,
    asset_records: assets.brands.length,
    normalized_files: assets.brands.filter((record) => resolvedPath(record, "normalized")).length,
    incomplete_assets: incomplete.length,
  },
  errors,
  warnings,
};
fs.writeFileSync(path.join(collectRoot, "brand-logo-closure-validation-v3.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;
