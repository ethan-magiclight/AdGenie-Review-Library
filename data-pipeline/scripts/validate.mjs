import { access } from "node:fs/promises";
import path from "node:path";

import { channels, normalizedLookupKey, pipelineRoot, readJson } from "./lib.mjs";

const durationRule = await readJson(path.join(pipelineRoot, "rules", "cleaning", "duration.json"));
const industryMap = await readJson(path.join(pipelineRoot, "rules", "mapping", "industry-map.json"));
const brandMap = await readJson(path.join(pipelineRoot, "rules", "mapping", "brand-normalization-map.json"));
const validIndustryIds = new Set(industryMap.industries.map((industry) => industry.id));
const displayNameByBrandId = new Map(
  (brandMap.canonical_brands || []).map((brand) => [brand.canonical_brand_id, brand.display_name]),
);
const errors = [];
const brandByAlias = new Map();
for (const mapping of brandMap.raw_brand_mappings) {
  const key = normalizedLookupKey(mapping.raw_brand);
  if (brandByAlias.has(key)) errors.push(`brand map: duplicate alias ${mapping.raw_brand}`);
  brandByAlias.set(key, mapping);
}
const aggregate = await readJson(path.join(pipelineRoot, "result", "creative-library.json"));
const aggregateIds = new Set();
const resourcePaths = new Set();
let channelTotal = 0;
const obsoleteWorkflowFields = new Set([
  "approved",
  "mapping_status",
  "mapping_statuses",
  "review_status",
  "visual_review_status",
]);

function obsoleteFields(value, prefix = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => obsoleteFields(item, `${prefix}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(obsoleteWorkflowFields.has(key) ? [`${prefix}.${key}`] : []),
    ...obsoleteFields(child, `${prefix}.${key}`),
  ]);
}

for (const channel of channels) {
  const source = await readJson(path.join(pipelineRoot, "source", channel, "records.json"));
  const result = await readJson(path.join(pipelineRoot, "result", channel, "records.json"));
  if (source.channel !== channel || result.channel !== channel) errors.push(`${channel}: channel mismatch`);
  if (source.count !== source.records.length) errors.push(`${channel}: source count mismatch`);
  if (result.stats.accepted !== result.records.length) errors.push(`${channel}: result count mismatch`);
  if (result.stats.input !== source.records.length) errors.push(`${channel}: input count mismatch`);
  const sourceObsoleteFields = obsoleteFields(source.records, channel);
  if (sourceObsoleteFields.length > 0) errors.push(`${channel}: obsolete source field ${sourceObsoleteFields[0]}`);
  channelTotal += result.records.length;

  const ids = new Set();
  for (const record of result.records) {
    if (ids.has(record.id)) errors.push(`${channel}: duplicate id ${record.id}`);
    ids.add(record.id);
    if (record.source_channel !== channel) errors.push(`${channel}: record channel mismatch ${record.id}`);
    if (!validIndustryIds.has(record.industry_id)) errors.push(`${channel}: invalid industry ${record.id}`);
    if (!record.brand_key) errors.push(`${channel}: missing normalized brand ${record.id}`);
    if (record.brand_id !== undefined) errors.push(`${channel}: obsolete brand_id ${record.id}`);
    if (record.brands?.some((brand) => brand.id !== undefined)) errors.push(`${channel}: obsolete nested brand id ${record.id}`);
    if (record.brands?.some((brand) => displayNameByBrandId.get(brand.brand_key) !== brand.name)) {
      errors.push(`${channel}: nested brand mapping mismatch ${record.id}`);
    }
    const brandMapping = brandByAlias.get(normalizedLookupKey(record.normalization?.original_brand));
    if (brandMapping?.canonical_brand_id !== record.brand_key || displayNameByBrandId.get(record.brand_key) !== record.brand) {
      errors.push(`${channel}: brand mapping mismatch ${record.id}`);
    }
    if (record.contact_sheet) resourcePaths.add(record.contact_sheet);
    if (record.brand_logo) resourcePaths.add(record.brand_logo);
    if (
      Number.isFinite(record.duration_seconds)
      && record.duration_seconds > durationRule.maximum_seconds
    ) errors.push(`${channel}: duration exceeds policy ${record.id}`);
  }
}

for (const record of aggregate.records) {
  if (aggregateIds.has(record.id)) errors.push(`aggregate: duplicate id ${record.id}`);
  aggregateIds.add(record.id);
}
if (aggregate.stats.accepted !== aggregate.records.length) errors.push("aggregate count mismatch");
if (aggregate.records.length !== channelTotal) errors.push("aggregate does not equal channel total");

const resourceManifest = await readJson(path.join(pipelineRoot, "resources", "manifest.json"));
const logoCatalog = await readJson(path.join(pipelineRoot, "resources", "brand-logo-catalog.json"));
if (resourceManifest.contact_sheet_count !== resourceManifest.contact_sheets.length) {
  errors.push("contact sheet resource count mismatch");
}
const catalogLogoCount = logoCatalog.brands.filter((brand) => brand.normalized_file_exists).length;
if (catalogLogoCount !== logoCatalog.summary.brands_with_local_normalized_logo) {
  errors.push("brand logo catalog count mismatch");
}
await Promise.all([...resourcePaths].map(async (resourcePath) => {
  try {
    await access(path.join(pipelineRoot, resourcePath));
  } catch {
    errors.push(`missing local resource ${resourcePath}`);
  }
}));

if (errors.length > 0) {
  throw new Error(`Validation failed:\n${errors.slice(0, 50).join("\n")}`);
}

console.log(JSON.stringify({
  valid: true,
  source_records: aggregate.stats.input,
  result_records: aggregate.records.length,
  channels: aggregate.stats.channels,
}, null, 2));
