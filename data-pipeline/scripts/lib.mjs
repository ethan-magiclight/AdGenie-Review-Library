import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

export const pipelineRoot = path.resolve(scriptsDirectory, "..");
export const channels = ["ads_of_the_world", "best_ads", "stash", "youtube"];

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function fileSha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function jsonSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export function recordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.records)) return value.records;
  if (Array.isArray(value.videos)) return value.videos;
  throw new Error("JSON input does not contain records or videos");
}

export function recordChannel(record) {
  return record.source_site || record.source_platform || record.source_channel || "unknown";
}

export function normalizedLookupKey(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
}

const workflowOnlyFields = new Set([
  "ai_generation_value",
  "ai_template_fit",
  "ai_visual_pre_review",
  "approved",
  "blacklisted",
  "canonical_match",
  "classification_normalization",
  "classification_source",
  "collection_batch",
  "collection_rule_version",
  "content_nature",
  "core_template_eligible",
  "decision_reason_codes",
  "discovery_score",
  "discovery_score_breakdown",
  "frames_reviewed",
  "imported_from",
  "integration_taxonomy_candidate",
  "mapping_status",
  "note",
  "reason_codes",
  "record_state",
  "review_events",
  "review_status",
  "source_contact_sheet",
  "schema_version",
  "status_ids",
  "quality_score",
  "quality_score_breakdown",
  "publisher_role",
  "recency_status",
  "source_verification_status",
  "visual_review",
  "visual_notes",
  "visual_review_status",
]);

export function stripWorkflowFields(record) {
  if (Array.isArray(record)) return record.map(stripWorkflowFields);
  if (!record || typeof record !== "object") return record;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !workflowOnlyFields.has(key))
      .map(([key, value]) => [key, stripWorkflowFields(value)]),
  );
}
