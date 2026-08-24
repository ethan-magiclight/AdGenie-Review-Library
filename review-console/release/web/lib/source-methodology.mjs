const requiredChannelIds = ["best_ads", "ads_of_the_world", "stash"];
const allowedChannelStatuses = new Set(["scope_complete", "integration_partial"]);

function nonEmptyStrings(values) {
  return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === "string" && value.trim());
}

export function validateSourceCollectionMethodology(value) {
  const errors = [];
  if (!value || typeof value !== "object") return ["source collection methodology must be an object"];
  if (value.version !== "v1") errors.push("source collection methodology version must be v1");
  if (!value.updated_at) errors.push("source collection methodology updated_at is required");
  if (!value.shared_rules || typeof value.shared_rules !== "object") errors.push("shared_rules is required");
  if (value.shared_rules?.visual_review_frames !== 10) errors.push("visual_review_frames must be 10");
  if (value.shared_rules?.genres_defaulted_from_visual_candidates !== true) errors.push("genre candidates must become review defaults");
  if (value.shared_rules?.media_delivery !== "remote_links") errors.push("media_delivery must be remote_links");
  if (value.shared_rules?.next_run_requires_ledger_update !== true) errors.push("next run must require a ledger update");
  if (!Array.isArray(value.channels)) return [...errors, "channels must be an array"];
  if (value.integration?.status && value.integration.status !== "PARTIAL") errors.push("integration status must be PARTIAL");

  const byId = new Map(value.channels.map((channel) => [channel?.id, channel]));
  for (const id of requiredChannelIds) {
    if (!byId.has(id)) errors.push(`missing channel methodology: ${id}`);
  }

  for (const channel of value.channels) {
    if (!channel?.id || !channel.name || !channel.status || !channel.objective) errors.push(`channel identity is incomplete: ${channel?.id || "unknown"}`);
    if (channel?.status && !allowedChannelStatuses.has(channel.status)) errors.push(`channel status is invalid: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.collection_plan)) errors.push(`collection_plan is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.quality_and_exclusion_rules)) errors.push(`quality_and_exclusion_rules is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.metadata_policy)) errors.push(`metadata_policy is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.continuation?.before_next_run)) errors.push(`continuation gate is required: ${channel?.id || "unknown"}`);
    if (!channel?.continuation?.resume_from) errors.push(`resume checkpoint is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.evidence)) errors.push(`evidence paths are required: ${channel?.id || "unknown"}`);
    if (!channel?.progress || typeof channel.progress !== "object") errors.push(`progress is required: ${channel?.id || "unknown"}`);
    if (channel?.status === "integration_partial" && !nonEmptyStrings(channel.progress?.partial_reasons)) {
      errors.push(`partial reasons are required: ${channel?.id || "unknown"}`);
    }
  }

  const best = byId.get("best_ads");
  if (best) {
    if (best.progress?.remaining_candidates !== 0) errors.push("Best Ads remaining_candidates must be 0");
    if (best.progress?.terminal_outcomes !== best.progress?.candidates) errors.push("Best Ads candidates must all have terminal outcomes");
    if (!(Number(best.progress?.reviewable_total) > 0)) errors.push("Best Ads reviewable_total must be positive");
  }

  const aotw = byId.get("ads_of_the_world");
  if (aotw) {
    if (!(Number(aotw.progress?.reviewable_total) > 0)) errors.push("Ads of the World reviewable_total must be positive");
    if (Number(aotw.progress?.details_remaining) > 0 && aotw.status !== "integration_partial") {
      errors.push("Ads of the World detail backlog requires integration_partial");
    }
  }

  const stash = byId.get("stash");
  if (stash) {
    if (!(Number(stash.progress?.reviewable_total) > 0)) errors.push("STASH reviewable_total must be positive");
    if (stash.progress?.discovery_unresolved === true && stash.status !== "integration_partial") {
      errors.push("STASH unresolved discovery requires integration_partial");
    }
    if (stash.progress?.integration_records !== stash.progress?.reviewable_total) {
      errors.push("STASH integration_records must equal reviewable_total");
    }
  }

  return errors;
}
