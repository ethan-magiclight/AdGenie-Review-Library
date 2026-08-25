import path from "node:path";

import { channels, pipelineRoot, readJson, stripWorkflowFields, writeJsonAtomic } from "./lib.mjs";

function localContactSheet(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/^\/media\//, "").replace(/^\.\//, "");
  if (normalized.startsWith("resources/contact-sheets/")) return normalized;
  if (normalized.startsWith("collect/")) return `resources/contact-sheets/${normalized}`;
  return normalized;
}

function compactClassificationCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const industry = value.industry || null;
  const productCategory = value.product_category || null;
  return industry || productCategory ? { industry, product_category: productCategory } : null;
}

function compactCategoryCandidates(values) {
  return (values || [])
    .map((value) => typeof value === "string" ? value : value?.category || value?.name)
    .filter(Boolean);
}

const summary = {};

for (const channel of channels) {
  const sourcePath = path.join(pipelineRoot, "source", channel, "records.json");
  const source = await readJson(sourcePath);
  const records = source.records.map((record) => {
    const cleaned = stripWorkflowFields(record);
    return {
      ...cleaned,
      crawl_collected_at: cleaned.crawl_collected_at || cleaned.collected_at || null,
      contact_sheet: localContactSheet(cleaned.contact_sheet),
      classification_candidate: compactClassificationCandidate(cleaned.classification_candidate),
      product_category_candidates: compactCategoryCandidates(cleaned.product_category_candidates),
    };
  });
  const normalized = {
    channel,
    origin: `main_snapshot_${channel}`,
    snapshot_at: source.snapshot_at || source.source_generated_at || null,
    pipeline_imported_at: source.pipeline_imported_at || new Date().toISOString(),
    count: records.length,
    records,
  };
  await writeJsonAtomic(sourcePath, normalized);
  summary[channel] = records.length;
}

await writeJsonAtomic(path.join(pipelineRoot, "source", "manifest.json"), {
  generated_at: new Date().toISOString(),
  channels: summary,
  total: Object.values(summary).reduce((sum, count) => sum + count, 0),
});

console.log(JSON.stringify({ normalized: summary }, null, 2));
