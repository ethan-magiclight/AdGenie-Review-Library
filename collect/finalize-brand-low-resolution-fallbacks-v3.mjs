#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(collectRoot, "brand-assets-v3", "registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
let finalized = 0;

for (const brand of registry.brands) {
  if (brand.status !== "rendered_page_logo_needs_review") continue;
  if (!brand.normalized?.file || !brand.source?.file) {
    throw new Error(`${brand.canonical_brand_id}: rendered-page failure has no prior official fallback asset`);
  }
  brand.status = "official_asset_low_resolution_fallback_pending_approval";
  brand.quality_tier = "official_low_resolution_fallback";
  brand.quality_note = "A higher-resolution official-page render was attempted but did not produce a reviewable brand mark. The traceable official-site raster source is retained and normalized to the shared 224x224 output contract; inspect at the intended 56x56 CSS size before approval.";
  brand.approved_for_product = false;
  brand.permission_status = brand.permission_status === "express_permission_required" ? brand.permission_status : "legal_and_visual_review_required";
  finalized += 1;
}

registry.summary = registry.brands.reduce((summary, record) => {
  summary.brand_count = registry.brands.length;
  summary[record.status] = (summary[record.status] ?? 0) + 1;
  return summary;
}, {});
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ finalized, summary: registry.summary }, null, 2));
