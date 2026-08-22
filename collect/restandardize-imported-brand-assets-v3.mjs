#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectImage, normalizeLogo } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(collectRoot, "brand-assets-v3");
const registryPath = path.join(outputRoot, "registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

let migrated = 0;
for (const record of registry.brands) {
  if (record.status !== "imported_existing_standardized_preview") continue;
  const legacyNormalizedPath = path.join(collectRoot, record.normalized_file);
  if (!fs.existsSync(legacyNormalizedPath)) throw new Error(`${record.canonical_brand_id}: missing legacy normalized file ${record.normalized_file}`);
  const brandRoot = path.join(outputRoot, record.canonical_brand_id);
  const sourceRoot = path.join(brandRoot, "source");
  const normalizedRoot = path.join(brandRoot, "output");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(normalizedRoot, { recursive: true });

  const legacySourcePath = record.source_file ? path.join(collectRoot, record.source_file) : legacyNormalizedPath;
  if (!fs.existsSync(legacySourcePath)) throw new Error(`${record.canonical_brand_id}: missing legacy source file ${record.source_file}`);
  const sourceExtension = path.extname(legacySourcePath).toLocaleLowerCase("en-US") || ".png";
  const sourcePath = path.join(sourceRoot, `${record.canonical_brand_id}-official${sourceExtension}`);
  fs.copyFileSync(legacySourcePath, sourcePath);
  const normalizedPath = path.join(normalizedRoot, `${record.canonical_brand_id}-icon@4x.png`);
  await normalizeLogo(legacyNormalizedPath, normalizedPath);

  const sourceBuffer = fs.readFileSync(sourcePath);
  const normalizedBuffer = fs.readFileSync(normalizedPath);
  const sourceDimensions = await inspectImage(sourcePath);
  const normalizedDimensions = await inspectImage(normalizedPath);
  record.status = record.canonical_brand_id === "apple"
    ? "official_asset_collected_permission_blocked"
    : "imported_official_asset_restandardized_pending_approval";
  record.source = {
    provenance: "existing_official_asset_registry",
    legacy_file: record.source_file,
    file: path.relative(outputRoot, sourcePath).split(path.sep).join("/"),
    bytes: sourceBuffer.length,
    sha256: sha256(sourceBuffer),
    width: sourceDimensions.width,
    height: sourceDimensions.height,
  };
  record.normalized = {
    file: path.relative(outputRoot, normalizedPath).split(path.sep).join("/"),
    mime: "image/png",
    bytes: normalizedBuffer.length,
    sha256: sha256(normalizedBuffer),
    width: normalizedDimensions.width,
    height: normalizedDimensions.height,
    intended_css_width: 56,
    intended_css_height: 56,
  };
  record.legacy_source_file = record.source_file;
  record.legacy_normalized_file = record.normalized_file;
  delete record.source_file;
  delete record.normalized_file;
  record.approved_for_product = false;
  if (record.canonical_brand_id === "apple") {
    record.permission_status = "express_permission_required";
    record.policy_note = "Apple artwork must not be enabled in product UI without express trademark permission.";
  }
  migrated += 1;
}

registry.summary = registry.brands.reduce((summary, record) => {
  summary.brand_count = registry.brands.length;
  summary[record.status] = (summary[record.status] ?? 0) + 1;
  return summary;
}, {});
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ migrated, summary: registry.summary }, null, 2));
