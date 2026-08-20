const requiredChannelIds = ["best_ads", "ads_of_the_world"];

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

  const byId = new Map(value.channels.map((channel) => [channel?.id, channel]));
  for (const id of requiredChannelIds) {
    if (!byId.has(id)) errors.push(`missing channel methodology: ${id}`);
  }

  for (const channel of value.channels) {
    if (!channel?.id || !channel.name || !channel.status || !channel.objective) errors.push(`channel identity is incomplete: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.collection_plan)) errors.push(`collection_plan is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.quality_and_exclusion_rules)) errors.push(`quality_and_exclusion_rules is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.metadata_policy)) errors.push(`metadata_policy is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.continuation?.before_next_run)) errors.push(`continuation gate is required: ${channel?.id || "unknown"}`);
    if (!channel?.continuation?.resume_from) errors.push(`resume checkpoint is required: ${channel?.id || "unknown"}`);
    if (!nonEmptyStrings(channel?.evidence)) errors.push(`evidence paths are required: ${channel?.id || "unknown"}`);
  }

  const best = byId.get("best_ads");
  if (best) {
    if (best.status !== "scope_complete") errors.push("Best Ads status must be scope_complete");
    if (best.progress?.remaining_candidates !== 0) errors.push("Best Ads remaining_candidates must be 0");
    if (best.progress?.terminal_outcomes !== best.progress?.candidates) errors.push("Best Ads candidates must all have terminal outcomes");
    if (best.progress?.reviewable_total !== 108) errors.push("Best Ads reviewable_total must be 108");
  }

  const aotw = byId.get("ads_of_the_world");
  if (aotw) {
    if (aotw.status !== "target_complete") errors.push("Ads of the World status must be target_complete");
    if (aotw.scope?.target_reviewable_total !== 100) errors.push("Ads of the World target must be 100");
    if (aotw.progress?.reviewable_total !== aotw.scope?.target_reviewable_total) errors.push("Ads of the World target is not complete");
  }

  return errors;
}
