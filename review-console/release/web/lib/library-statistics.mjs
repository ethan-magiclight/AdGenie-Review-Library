/**
 * Pure aggregation helpers for the review-console supply matrix.
 *
 * The module deliberately reads only confirmed `industry` and
 * `product_category` values.  Candidate fields are evidence for a later
 * review and must not change the counts used by the product type matrix.
 */

export const UNKNOWN_INDUSTRY = "待确认行业";
export const UNKNOWN_PRODUCT_CATEGORY = "待确认品类";

export const DURATION_BAND_KEYS = Object.freeze([
  "duration_le_30s",
  "duration_30_to_60s",
  "duration_gt_60s",
  "duration_missing",
]);

export const DURATION_BANDS = Object.freeze([
  Object.freeze({ key: "duration_le_30s", label: "≤30s", order: 1, min_exclusive_seconds: 0, max_inclusive_seconds: 30 }),
  Object.freeze({ key: "duration_30_to_60s", label: "30–60s", order: 2, min_exclusive_seconds: 30, max_inclusive_seconds: 60 }),
  Object.freeze({ key: "duration_gt_60s", label: ">60s", order: 3, min_exclusive_seconds: 60, max_inclusive_seconds: null }),
  Object.freeze({ key: "duration_missing", label: "时长缺失", order: 4, min_exclusive_seconds: null, max_inclusive_seconds: null }),
]);

export const STATISTICS_COLUMNS = Object.freeze([
  "row_type",
  "dimension_key",
  "industry_id",
  "industry",
  "industry_zh",
  "industry_classification_status",
  "reserved_industry_raw_values",
  "industry_raw_values",
  "product_category_id",
  "product_category",
  "product_category_zh",
  "product_category_raw_values",
  "duration_band_id",
  "duration_band_key",
  "duration_label",
  "duration_order",
  "duration_min_exclusive_seconds",
  "duration_max_inclusive_seconds",
  "record_count",
  "unique_master_count",
  "deliverable_count",
  "unique_deliverable_master_count",
  "pending_review_count",
  "approved_count",
  "core_template_eligible_count",
  "excluded_count",
  "blacklisted_count",
  "classification_confirmed_count",
  "classification_candidate_count",
  "classification_unclassified_count",
  "dimension_conflict_count",
  "canonical_mapping_count",
  "canonical_mapping_conflict_count",
  "canonical_mapping_rules",
  "canonical_mapping_conflicts",
  "source_breakdown",
  "duration_le_30s",
  "duration_30_to_60s",
  "duration_gt_60s",
  "duration_missing",
  "low_frequency",
]);

const UNKNOWN_VALUE_TOKENS = new Set(["unclassified"]);
const RESERVED_INDUSTRY_TOKENS = new Set([
  "other",
  "unclassified",
  "跨行业 / 方法参考",
  "跨行业 / 奖项库",
]);
const BLACKLIST_STATUS_ID = "blacklisted";
const EXCLUDED_STATUS_ID = "excluded";
const APPROVED_STATUS_ID = "approved";
const FORMAL_SOURCE_SITES = new Set(["ads_of_the_world", "best_ads", "stash"]);
const DEFAULT_ZH = "待补中文";
const CONFIRMED_CLASSIFICATION_STATUSES = new Set([
  "source_verified",
  "visual_verified",
  "human_confirmed",
]);
const CANDIDATE_CLASSIFICATION_STATUSES = new Set([
  "candidate",
  "mapped_candidate",
  "pending_category_review",
  "pending_manual",
  "pending_review",
]);
const GENERIC_CATEGORY_PATTERN = /^(?:general|other|miscellaneous)\b/i;

function meaningful(value) {
  return value !== null
    && value !== undefined
    && (!(typeof value === "string") || value.trim() !== "");
}

function text(value) {
  return meaningful(value) ? String(value).trim() : "";
}

function classificationValue(value, unknownLabel) {
  const normalized = text(value);
  if (!normalized || UNKNOWN_VALUE_TOKENS.has(normalized.toLowerCase())) {
    return { key: null, label: unknownLabel, raw: meaningful(value) ? value : null };
  }
  return { key: normalized, label: normalized, raw: value };
}

function industryClassificationValue(value) {
  const result = classificationValue(value, UNKNOWN_INDUSTRY);
  if (result.key !== null && RESERVED_INDUSTRY_TOKENS.has(result.key.toLowerCase())) {
    return {
      ...result,
      key: null,
      label: UNKNOWN_INDUSTRY,
      reserved: true,
    };
  }
  return { ...result, reserved: false };
}

function filterSet(value, unknownLabel) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const values = Array.isArray(value) ? value : [value];
  const result = new Set();
  for (const entry of values) {
    const normalized = text(entry);
    if (!normalized || normalized.toLowerCase() === "all") continue;
    if (UNKNOWN_VALUE_TOKENS.has(normalized.toLowerCase())
      || normalized === unknownLabel
      || (unknownLabel === UNKNOWN_INDUSTRY && RESERVED_INDUSTRY_TOKENS.has(normalized.toLowerCase()))) {
      result.add(unknownLabel);
    } else {
      result.add(normalized);
    }
  }
  return result.size ? result : null;
}

function matchesFilter(value, filter) {
  return !filter
    || filter.has(value.label)
    || filter.has(value.id)
    || filter.has(value.zh)
    || filter.has(value.raw)
    || (value.mapping?.rules || []).some((rule) => filter.has(rule.from) || filter.has(rule.to))
    || (value.key !== null && filter.has(value.key));
}

function stableSlug(value, fallback) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  const slug = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  const codePoints = [...normalized].map((character) => character.codePointAt(0).toString(16)).join("-");
  return codePoints || fallback;
}

function dimensionId(prefix, key, unknownLabel) {
  return key === null ? `${prefix}:unclassified` : `${prefix}:${stableSlug(key, stableSlug(unknownLabel, "unknown"))}`;
}

function registryEntries(source, type) {
  if (!source || typeof source !== "object") return [];
  const candidates = type === "industry"
    ? [source.industries, source.industry_registry, source.canonical_industries]
    : [source.categories, source.category_registry, source.product_categories, source.canonical_categories];
  return candidates.find(Array.isArray) || [];
}

function registryValue(entry, type) {
  if (typeof entry === "string") return { value: entry, zh: null, id: null, industry: null };
  if (!entry || typeof entry !== "object") return { value: null, zh: null, id: null, industry: null };
  const value = type === "industry"
    ? entry.industry ?? entry.key ?? entry.name ?? entry.value
    : entry.category ?? entry.product_category ?? entry.key ?? entry.name ?? entry.value;
  return {
    value: meaningful(value) ? String(value).trim() : null,
    zh: meaningful(entry.zh) ? String(entry.zh).trim() : meaningful(entry.label_zh) ? String(entry.label_zh).trim() : null,
    id: meaningful(entry.id) ? String(entry.id).trim() : null,
    industry: meaningful(entry.industry) ? String(entry.industry).trim() : null,
  };
}

function taxonomyMap(taxonomy, key) {
  const value = taxonomy && typeof taxonomy === "object" ? taxonomy[key] : null;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function aliasResolution(value, aliases, kind) {
  const raw = text(value);
  let current = raw;
  const rules = [];
  const seen = new Set();
  while (current && Object.hasOwn(aliases, current) && !seen.has(current)) {
    seen.add(current);
    const next = text(aliases[current]);
    if (!next || next === current) break;
    rules.push({
      kind,
      from: current,
      to: next,
      rule: `${kind}:${current}->${next}`,
    });
    current = next;
  }
  return { raw, value: current, rules };
}

function categoryResolution(value, taxonomy = {}) {
  return aliasResolution(value, taxonomyMap(taxonomy, "category_aliases"), "category_alias");
}

function categoryParentOverride(category, taxonomy = {}) {
  const overrides = taxonomyMap(taxonomy, "category_parent_overrides");
  const isObject = category && typeof category === "object";
  const raw = text(isObject ? category.raw : category);
  const canonical = text(isObject ? category.value : category);
  return text(overrides[canonical]) || text(overrides[raw]) || "";
}

function categoryParentConflict(category, taxonomy = {}) {
  const conflicts = taxonomyMap(taxonomy, "category_parent_conflicts");
  const isObject = category && typeof category === "object";
  const raw = text(isObject ? category.raw : category);
  const canonical = text(isObject ? category.value : category);
  return conflicts[canonical] || conflicts[raw] || null;
}

function categoryEvidenceValues(category) {
  const isObject = category && typeof category === "object";
  const raw = text(isObject ? category.raw : category);
  const canonical = text(isObject ? category.value : category);
  return new Set([raw, canonical].filter(Boolean));
}

function industryResolution(value, {
  category = null,
  taxonomy = {},
  applyParentOverride = false,
  allowReservedParentOverride = false,
} = {}) {
  const raw = text(value);
  let current = raw;
  const rules = [];
  let requiresReview = false;
  const conditionalRules = Array.isArray(taxonomy?.conditional_industry_rules)
    ? taxonomy.conditional_industry_rules
    : [];
  const categoryValues = categoryEvidenceValues(category);
  const conditional = conditionalRules.find((rule) => (
    text(rule?.from) === current
      && (!Array.isArray(rule?.when_categories) || rule.when_categories.some((item) => categoryValues.has(text(item))))
  ));
  if (conditional?.to) {
    const next = text(conditional.to);
    if (next && next !== current) {
      rules.push({
        kind: "industry_conditional",
        from: current,
        to: next,
        rule: `industry_conditional:${current}->${next}`,
        status: text(conditional.status) || null,
        evidence: text(conditional.evidence) || null,
      });
      current = next;
      requiresReview = conditional.status === "pending_category_review";
    }
  }
  const aliases = aliasResolution(current, taxonomyMap(taxonomy, "canonical_industry_aliases"), "industry_alias");
  rules.push(...aliases.rules);
  current = aliases.value;

  const override = applyParentOverride ? categoryParentOverride(category, taxonomy) : "";
  const normalizedOverride = aliasResolution(override, taxonomyMap(taxonomy, "canonical_industry_aliases"), "industry_parent_override_alias");
  const reserved = !current || RESERVED_INDUSTRY_TOKENS.has(current.toLowerCase());
  const categoryValue = text(category && typeof category === "object" ? category.value : category);
  if (override && (current === categoryValue || (allowReservedParentOverride && reserved))) {
    if (current !== normalizedOverride.value) {
      rules.push({
        kind: "category_parent_override",
        from: current || null,
        to: normalizedOverride.value,
        rule: `category_parent_override:${categoryValue || text(category?.raw)}->${normalizedOverride.value}`,
        evidence: "taxonomy.category_parent_overrides",
      });
      rules.push(...normalizedOverride.rules);
      current = normalizedOverride.value;
      requiresReview = true;
    }
  } else if (override && current && current !== normalizedOverride.value) {
    rules.push({
      kind: "category_parent_conflict",
      from: current,
      to: normalizedOverride.value,
      rule: `category_parent_conflict:${categoryValue || text(category?.raw)}:${current}!=${normalizedOverride.value}`,
      evidence: "taxonomy.category_parent_overrides",
    });
    requiresReview = true;
  }
  return {
    raw,
    value: current,
    rules,
    requiresReview,
    reserved: Boolean(raw) && RESERVED_INDUSTRY_TOKENS.has(raw.toLowerCase()),
    inferredFromCategory: rules.some((rule) => rule.kind === "category_parent_override"),
  };
}

function buildDimensionRegistry(input, options) {
  const state = options.state && typeof options.state === "object" ? options.state : null;
  const taxonomy = options.taxonomy && typeof options.taxonomy === "object" ? options.taxonomy : null;
  const sources = [options.registry, taxonomy, state, input].filter((source) => source && typeof source === "object");
  const industries = new Map();
  const categories = new Map();
  const categoryParents = new Map();
  for (const source of sources) {
    for (const entry of registryEntries(source, "industry")) {
      const parsed = registryValue(entry, "industry");
      if (!parsed.value) continue;
      const normalized = industryResolution(parsed.value, { taxonomy });
      if (!normalized.value) continue;
      const key = normalized.value;
      const next = {
        ...parsed,
        value: key,
        raw_value: parsed.value,
        raw_values: [parsed.value],
        mapping_rules: normalized.rules,
      };
      if (!industries.has(key)) industries.set(key, next);
      else {
        const existing = industries.get(key);
        industries.set(key, {
          ...existing,
          zh: existing.zh || next.zh,
          id: existing.id || next.id,
          raw_values: [...new Set([...(existing.raw_values || []), ...(next.raw_values || [])])],
          mapping_rules: [...(existing.mapping_rules || []), ...(next.mapping_rules || [])],
        });
      }
    }
    for (const entry of registryEntries(source, "category")) {
      const parsed = registryValue(entry, "category");
      if (!parsed.value) continue;
      const category = categoryResolution(parsed.value, taxonomy);
      const parent = industryResolution(parsed.industry, {
        category: { raw: parsed.value, value: category.value },
        taxonomy,
        applyParentOverride: true,
        allowReservedParentOverride: true,
      });
      const normalized = {
        ...parsed,
        value: category.value,
        raw_value: parsed.value,
        raw_values: [parsed.value],
        industry: parent.value || null,
        raw_industry: parsed.industry,
        mapping_rules: [...category.rules, ...parent.rules],
      };
      const key = JSON.stringify([normalized.industry, normalized.value]);
      if (!categories.has(key)) categories.set(key, normalized);
      else {
        const existing = categories.get(key);
        categories.set(key, {
          ...existing,
          zh: existing.zh || normalized.zh,
          id: existing.id || normalized.id,
          raw_values: [...new Set([...(existing.raw_values || []), ...(normalized.raw_values || [])])],
          mapping_rules: [...(existing.mapping_rules || []), ...(normalized.mapping_rules || [])],
        });
      }
      if (normalized.industry) {
        if (!categoryParents.has(normalized.value)) categoryParents.set(normalized.value, new Set());
        categoryParents.get(normalized.value).add(normalized.industry);
      }
    }
  }
  return { industries, categories, categoryParents, taxonomy, state };
}

function dimensionInfo(value, type, registry, parentIndustryKey = null, context = {}) {
  const unknownLabel = type === "industry" ? UNKNOWN_INDUSTRY : UNKNOWN_PRODUCT_CATEGORY;
  const taxonomy = registry?.taxonomy || context.taxonomy || {};
  const resolved = type === "industry"
    ? industryResolution(value, {
      category: context.category,
      taxonomy,
      applyParentOverride: context.applyParentOverride !== false,
    })
    : categoryResolution(value, taxonomy);
  const classified = type === "industry"
    ? industryClassificationValue(resolved.value)
    : classificationValue(resolved.value, unknownLabel);
  if (classified.key === null) {
    return {
      ...classified,
      id: dimensionId(type === "industry" ? "industry" : "category", null, unknownLabel),
      zh: unknownLabel,
      raw: meaningful(value) ? value : null,
      mapping: {
        raw: meaningful(value) ? String(value).trim() : "",
        canonical: null,
        rules: resolved.rules || [],
        requires_review: Boolean(resolved.requiresReview),
        reserved: Boolean(resolved.reserved),
        inferred_from_category: Boolean(resolved.inferredFromCategory),
      },
      requires_review: Boolean(resolved.requiresReview),
    };
  }
  const entries = registry?.[type === "industry" ? "industries" : "categories"];
  const registryEntry = type === "category"
    ? (entries?.get(JSON.stringify([parentIndustryKey, classified.key]))
      || entries?.get(JSON.stringify([null, classified.key]))
      || [...(entries?.values() || [])].find((entry) => entry.value === classified.key))
    : entries?.get(classified.key);
  return {
    ...classified,
    id: registryEntry?.id || dimensionId(type === "industry" ? "industry" : "category", classified.key, unknownLabel),
    zh: registryEntry?.zh || DEFAULT_ZH,
    raw: meaningful(value) ? value : null,
    mapping: {
      raw: meaningful(value) ? String(value).trim() : "",
      canonical: classified.key,
      rules: resolved.rules || [],
      requires_review: Boolean(resolved.requiresReview),
      reserved: Boolean(resolved.reserved),
      inferred_from_category: Boolean(resolved.inferredFromCategory),
    },
    requires_review: Boolean(resolved.requiresReview),
  };
}

function dimensionsForVideo(video, registry) {
  const taxonomy = registry?.taxonomy || {};
  const category = dimensionInfo(video?.product_category, "category", registry, null, { taxonomy });
  const industry = dimensionInfo(video?.industry, "industry", registry, category.key, {
    taxonomy,
    category: {
      raw: meaningful(video?.product_category) ? video.product_category : null,
      value: category.key,
    },
    applyParentOverride: true,
  });
  const linkedCategory = dimensionInfo(video?.product_category, "category", registry, industry.key, { taxonomy });
  return { industry, productCategory: linkedCategory };
}

function durationSeconds(video) {
  const value = typeof video?.duration_seconds === "string"
    ? video.duration_seconds.trim()
    : video?.duration_seconds;
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Return the mutually-exclusive duration column for a duration in seconds. */
export function durationBand(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isFinite(number) || number <= 0) return "duration_missing";
  if (number <= 30) return "duration_le_30s";
  if (number <= 60) return "duration_30_to_60s";
  return "duration_gt_60s";
}

export const classifyDuration = durationBand;
export const getDurationBand = durationBand;

export function durationBandInfo(value) {
  const key = durationBand(value);
  return DURATION_BANDS.find((band) => band.key === key) || DURATION_BANDS[DURATION_BANDS.length - 1];
}

function blacklisted(video) {
  return video?.blacklisted === true
    || (Array.isArray(video?.status_ids) && video.status_ids.includes(BLACKLIST_STATUS_ID));
}

function availableMedia(video) {
  if (video?.media_access_status === "available") return true;
  const assets = Array.isArray(video?.media_assets) ? video.media_assets : [];
  return assets.some((asset) => (
    asset?.access_status === "available"
    || asset?.media_access_status === "available"
    || asset?.manifest_status === "ok"
  ));
}

function contactSheetEvidence(video) {
  if (meaningful(video?.contact_sheet)) return true;
  if (Number(video?.frames_reviewed) >= 10) return true;
  const assets = Array.isArray(video?.media_assets) ? video.media_assets : [];
  return assets.some((asset) => (
    meaningful(asset?.contact_sheet_path)
    || asset?.contact_sheet_status === "available"
    || Number(asset?.sheet_validation?.frame_count) >= 10
    || (Array.isArray(asset?.visual_fingerprint?.frame_hashes)
      && asset.visual_fingerprint.frame_hashes.length >= 10)
  ));
}

/**
 * The default delivery gate requires both a validated media asset and
 * contact-sheet/frame evidence.  Callers can provide `isDeliverable` when a
 * product-specific delivery policy needs a different gate.
 */
export function isDeliverableRecord(video) {
  return availableMedia(video) && contactSheetEvidence(video);
}

export const isMediaAvailable = availableMedia;
export const hasContactSheetEvidence = contactSheetEvidence;

function pendingReview(video) {
  return video?.review_status === "pending_review"
    || (Array.isArray(video?.status_ids) && video.status_ids.includes("pending_review"));
}

function hasStatus(video, statusId) {
  return (Array.isArray(video?.status_ids) && video.status_ids.includes(statusId))
    || video?.[statusId] === true;
}

function approved(video) {
  return video?.approved === true || hasStatus(video, APPROVED_STATUS_ID);
}

function excluded(video) {
  return video?.excluded === true || hasStatus(video, EXCLUDED_STATUS_ID);
}

function manualClassificationConfirmed(video) {
  return (Array.isArray(video?.review_events) ? video.review_events : []).some((event) => {
    if (event?.action !== "classification_update") return false;
    const before = event.before && typeof event.before === "object" ? event.before : {};
    const after = event.after && typeof event.after === "object" ? event.after : {};
    return ["industry", "product_category"].some((field) => (
      Object.hasOwn(after, field) && text(after[field]) !== text(before[field])
    ));
  });
}

function classificationReviewState(video) {
  if (manualClassificationConfirmed(video)) return "confirmed";
  const candidate = video?.classification_candidate;
  const status = text(
    video?.classification_review_status
    || candidate?.classification_review_status
    || candidate?.status,
  );
  if (CONFIRMED_CLASSIFICATION_STATUSES.has(status)) return "confirmed";
  if (CANDIDATE_CLASSIFICATION_STATUSES.has(status)
    || candidate?.source_needs_manual === true
    || candidate?.registry_unresolved === true
    || (candidate?.conflict_status && candidate.conflict_status !== "none")) return "candidate";
  return null;
}

function classificationState(video, industry, productCategory) {
  const reviewState = classificationReviewState(video);
  if (reviewState === "candidate") return "candidate";
  if (GENERIC_CATEGORY_PATTERN.test(text(productCategory.raw || productCategory.key))) return "candidate";
  if (industry.requires_review || productCategory.requires_review) return "candidate";
  if (industry.key !== null && productCategory.key !== null
    && (reviewState === "confirmed" || reviewState === null)) return "confirmed";
  const candidate = video?.classification_candidate;
  const candidateValues = [];
  if (industry.key === null) candidateValues.push(
    { value: video?.industry_candidate, type: "industry" },
    { value: video?.classification_candidate?.industry, type: "industry" },
  );
  if (productCategory.key === null) candidateValues.push(
    { value: video?.product_category_candidate, type: "category" },
    { value: video?.classification_candidate?.product_category, type: "category" },
  );
  const candidateArrays = productCategory.key === null
    ? [video?.product_category_candidates, video?.classification_candidate?.alternatives]
    : [];
  const hasCandidateValue = candidateValues.some(({ value, type }) => {
    if (!meaningful(value)) return false;
    if (typeof value === "string" && UNKNOWN_VALUE_TOKENS.has(value.trim().toLowerCase())) return false;
    if (type === "industry" && typeof value === "string" && RESERVED_INDUSTRY_TOKENS.has(value.trim().toLowerCase())) return false;
    return true;
  });
  if (hasCandidateValue || candidateArrays.some((value) => Array.isArray(value) && value.some((entry) => {
    const candidate = typeof entry === "string" ? entry : entry?.category || entry?.product_category || entry?.industry;
    return meaningful(candidate) && !UNKNOWN_VALUE_TOKENS.has(String(candidate).trim().toLowerCase());
  }))) {
    return "candidate";
  }
  return "unclassified";
}

function sourceKey(video) {
  const source = text(video?.source_site) || text(video?.source_platform) || "unknown";
  return source;
}

function conflictDetails(video, industry, productCategory, registry) {
  const reasons = new Set();
  const normalization = video?.classification_normalization;
  const candidate = video?.classification_candidate;
  const conflictStatus = normalization?.conflict_status || candidate?.conflict_status;
  if (conflictStatus && conflictStatus !== "none") reasons.add(String(conflictStatus));
  if (Array.isArray(normalization?.parent_industry_options) && normalization.parent_industry_options.length > 1) {
    reasons.add("multiple_parent_industries");
  }
  const taxonomy = registry?.taxonomy || {};
  const registryParents = registry?.categoryParents?.get(productCategory.key);
  if (registryParents && registryParents.size > 1) reasons.add("registry_parent_collision");
  const parentConflicts = taxonomy.category_parent_conflicts || taxonomy.parent_conflicts || {};
  const categoryConflict = productCategory.key !== null
    ? (parentConflicts[productCategory.key] || categoryParentConflict(productCategory, taxonomy))
    : categoryParentConflict(productCategory, taxonomy);
  if (categoryConflict) {
    const allowed = Array.isArray(categoryConflict.allowed_industries) ? categoryConflict.allowed_industries : [];
    if (allowed.length > 1) reasons.add("taxonomy_parent_conflict");
    if (industry.key !== null && allowed.length && !allowed.includes(industry.key)) reasons.add("taxonomy_parent_mismatch");
  }
  const manualConflicts = Array.isArray(taxonomy.manual_conflicts) ? taxonomy.manual_conflicts : [];
  if (manualConflicts.includes(productCategory.key) || manualConflicts.includes(industry.key)) reasons.add("taxonomy_manual_conflict");
  for (const dimension of [industry, productCategory]) {
    for (const rule of dimension?.mapping?.rules || []) {
      if (rule?.kind === "category_parent_conflict") reasons.add("canonical_parent_override_conflict");
      if (rule?.kind === "industry_conditional" && rule?.status === "pending_category_review") {
        reasons.add("conditional_industry_pending_review");
      }
    }
  }
  const declaredConflict = categoryParentConflict(productCategory, taxonomy);
  if (declaredConflict?.status === "pending_manual") reasons.add("taxonomy_parent_conflict");
  return [...reasons];
}

function masterKey(video, index) {
  if (meaningful(video?.canonical_master_id)) return `canonical:${String(video.canonical_master_id).trim()}`;
  if (meaningful(video?.video_id)) return `video:${String(video.video_id).trim()}`;
  if (meaningful(video?.id)) return `record:${String(video.id).trim()}`;
  return `record-index:${index}`;
}

function emptyDurationCounts() {
  return Object.fromEntries(DURATION_BAND_KEYS.map((key) => [key, 0]));
}

function emptyAggregate() {
  return {
    record_count: 0,
    unique_master_count: 0,
    deliverable_count: 0,
    pending_review_count: 0,
    approved_count: 0,
    core_template_eligible_count: 0,
    excluded_count: 0,
    blacklisted_count: 0,
    unique_deliverable_master_count: 0,
    classification_counts: {
      confirmed: 0,
      candidate: 0,
      unclassified: 0,
    },
    dimension_conflict_count: 0,
    dimension_conflict_reasons: new Set(),
    canonical_mapping_count: 0,
    canonical_mapping_conflict_count: 0,
    canonical_mapping_rules: new Set(),
    canonical_mapping_conflicts: new Set(),
    industry_raw_values: new Set(),
    product_category_raw_values: new Set(),
    reserved_industry_values: new Set(),
    source_breakdown: {},
    duration_bands: emptyDurationCounts(),
    low_frequency: false,
  };
}

function mutableAggregate() {
  return {
    ...emptyAggregate(),
    _masters: new Set(),
    _deliverableMasters: new Set(),
  };
}

function addRecord(aggregate, video, index, context) {
  aggregate.record_count += 1;
  aggregate._masters.add(masterKey(video, index));
  const isDeliverable = context.isDeliverable(video);
  if (isDeliverable) {
    aggregate.deliverable_count += 1;
    aggregate._deliverableMasters.add(masterKey(video, index));
  }
  if (pendingReview(video)) aggregate.pending_review_count += 1;
  if (approved(video)) aggregate.approved_count += 1;
  if (video?.core_template_eligible === true) aggregate.core_template_eligible_count += 1;
  if (excluded(video)) aggregate.excluded_count += 1;
  if (blacklisted(video)) aggregate.blacklisted_count += 1;
  const state = classificationState(video, context.industry, context.productCategory);
  aggregate.classification_counts[state] += 1;
  for (const dimension of [context.industry, context.productCategory]) {
    if (meaningful(dimension?.raw)) {
      if (dimension === context.industry) aggregate.industry_raw_values.add(String(dimension.raw).trim());
      else aggregate.product_category_raw_values.add(String(dimension.raw).trim());
    }
    const rules = Array.isArray(dimension?.mapping?.rules) ? dimension.mapping.rules : [];
    if (rules.length) aggregate.canonical_mapping_count += 1;
    for (const rule of rules) {
      const ruleText = rule?.rule || `${rule?.kind || "mapping"}:${rule?.from || ""}->${rule?.to || ""}`;
      aggregate.canonical_mapping_rules.add(String(ruleText));
      if (rule?.kind === "category_parent_conflict" || rule?.kind === "taxonomy_parent_conflict") {
        aggregate.canonical_mapping_conflict_count += 1;
        aggregate.canonical_mapping_conflicts.add(String(ruleText));
      }
    }
  }
  const conflicts = conflictDetails(video, context.industry, context.productCategory, context.registry);
  if (conflicts.length) {
    aggregate.dimension_conflict_count += 1;
    for (const reason of conflicts) aggregate.dimension_conflict_reasons.add(reason);
  }
  if (context.industry.reserved && meaningful(context.industry.raw)) {
    aggregate.reserved_industry_values.add(String(context.industry.raw).trim());
  }
  const source = sourceKey(video);
  aggregate.source_breakdown[source] = (aggregate.source_breakdown[source] || 0) + 1;
  aggregate.duration_bands[durationBand(durationSeconds(video))] += 1;
}

function finalizeAggregate(aggregate, lowFrequencyThreshold) {
  const durationBands = { ...aggregate.duration_bands };
  const classificationCounts = { ...aggregate.classification_counts };
  return {
    record_count: aggregate.record_count,
    unique_master_count: aggregate._masters.size,
    deliverable_count: aggregate.deliverable_count,
    unique_deliverable_master_count: aggregate._deliverableMasters.size,
    pending_review_count: aggregate.pending_review_count,
    approved_count: aggregate.approved_count,
    core_template_eligible_count: aggregate.core_template_eligible_count,
    excluded_count: aggregate.excluded_count,
    blacklisted_count: aggregate.blacklisted_count,
    classification_counts: classificationCounts,
    classification_confirmed_count: classificationCounts.confirmed,
    classification_candidate_count: classificationCounts.candidate,
    classification_unclassified_count: classificationCounts.unclassified,
    dimension_conflict_count: aggregate.dimension_conflict_count,
    dimension_conflict: aggregate.dimension_conflict_count > 0,
    dimension_conflict_reasons: [...aggregate.dimension_conflict_reasons].sort(),
    canonical_mapping_count: aggregate.canonical_mapping_count,
    canonical_mapping_conflict_count: aggregate.canonical_mapping_conflict_count,
    canonical_mapping_rules: [...aggregate.canonical_mapping_rules].sort(),
    canonical_mapping_conflicts: [...aggregate.canonical_mapping_conflicts].sort(),
    industry_raw_values: [...aggregate.industry_raw_values].sort(),
    product_category_raw_values: [...aggregate.product_category_raw_values].sort(),
    industry_classification_status: aggregate.reserved_industry_values.size
      ? "reserved_unclassified"
      : aggregate.record_count > 0 && aggregate.classification_counts.confirmed === aggregate.record_count
        ? "confirmed"
        : "unclassified_or_candidate",
    reserved_industry_raw_values: [...aggregate.reserved_industry_values].sort(),
    source_breakdown: { ...aggregate.source_breakdown },
    duration_bands: durationBands,
    duration_le_30s: durationBands.duration_le_30s,
    duration_30_to_60s: durationBands.duration_30_to_60s,
    duration_gt_60s: durationBands.duration_gt_60s,
    duration_missing: durationBands.duration_missing,
    low_frequency: aggregate.record_count > 0 && aggregate.record_count < lowFrequencyThreshold,
  };
}

function rowFromAggregate({ rowType, industry, productCategory, aggregate, lowFrequencyThreshold }) {
  const industryId = industry.id || dimensionId("industry", industry.key, UNKNOWN_INDUSTRY);
  const productCategoryId = productCategory?.id || (productCategory ? dimensionId("category", productCategory.key, UNKNOWN_PRODUCT_CATEGORY) : "category:all");
  return {
    row_type: rowType,
    dimension_key: `${industryId}::${productCategoryId}`,
    industry_id: industryId,
    industry: industry.label,
    industry_zh: industry.zh || DEFAULT_ZH,
    industry_key: industry.key,
    industry_raw: industry.raw,
    product_category_id: productCategory ? productCategoryId : null,
    product_category: productCategory ? productCategory.label : null,
    product_category_zh: productCategory ? (productCategory.zh || DEFAULT_ZH) : null,
    product_category_key: productCategory ? productCategory.key : null,
    product_category_raw: productCategory ? productCategory.raw : null,
    ...finalizeAggregate(aggregate, lowFrequencyThreshold),
  };
}

function durationRowFromAggregate({ band, aggregate, lowFrequencyThreshold, industry = null }) {
  const industryId = industry?.id || null;
  return {
    row_type: "duration",
    dimension_key: industryId ? `${industryId}::duration:${band.key}` : `duration:${band.key}`,
    duration_band_id: band.key,
    duration_band_key: band.key,
    duration_label: band.label,
    duration_order: band.order,
    duration_min_exclusive_seconds: band.min_exclusive_seconds,
    duration_max_inclusive_seconds: band.max_inclusive_seconds,
    industry_id: industryId,
    industry: industry?.label || null,
    industry_zh: industry?.zh || null,
    industry_key: industry?.key || null,
    industry_raw: industry?.raw || null,
    product_category_id: null,
    product_category: null,
    product_category_zh: null,
    product_category_key: null,
    product_category_raw: null,
    ...finalizeAggregate(aggregate, lowFrequencyThreshold),
  };
}

function sortRows(left, right) {
  const industry = String(left.industry).localeCompare(String(right.industry), "en", { sensitivity: "base" });
  if (industry !== 0) return industry;
  if (left.row_type !== right.row_type) return left.row_type === "category" ? -1 : 1;
  return String(left.product_category || "").localeCompare(String(right.product_category || ""), "en", { sensitivity: "base" });
}

function extractVideos(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.videos)) return value.videos;
  return [];
}

function sourceFilterSet(value) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const values = Array.isArray(value) ? value : [value];
  const result = new Set(values.map((entry) => text(entry)).filter(Boolean));
  return result.size ? result : null;
}

function sourceMatches(video, { scope, sourceSites, sourcePlatforms }) {
  const site = text(video?.source_site);
  const platform = text(video?.source_platform);
  const normalizedScope = String(scope || "all").toLowerCase();
  if (["formal", "three_channel", "three-channels", "formal_three_sources", "formal-three-sources"].includes(normalizedScope)) {
    if (!FORMAL_SOURCE_SITES.has(site)) return false;
  }
  if (["youtube", "youtube_legacy", "youtube-legacy"].includes(normalizedScope)
    && site !== "youtube" && platform !== "youtube") return false;
  if (sourceSites && !sourceSites.has(site) && !sourceSites.has(platform)) return false;
  if (sourcePlatforms && !sourcePlatforms.has(platform)) return false;
  return true;
}

function registryDiagnostics(registry, industryRows, categoryRows) {
  const industryCounts = new Map(industryRows.map((row) => [row.industry_key, row.record_count]));
  const categoryCounts = new Map(categoryRows.map((row) => [
    JSON.stringify([row.industry_key, row.product_category_key]),
    row.record_count,
  ]));
  const emptyIndustries = [];
  for (const [key, entry] of registry.industries.entries()) {
    if (!industryCounts.has(key)) {
      emptyIndustries.push({
        industry_id: entry.id || dimensionId("industry", key, UNKNOWN_INDUSTRY),
        industry: key,
        industry_zh: entry.zh || DEFAULT_ZH,
        record_count: 0,
      });
    }
  }
  const emptyCategories = [];
  for (const [pair, entry] of registry.categories.entries()) {
    if (!categoryCounts.has(pair)) {
      const [industryKey, categoryKey] = JSON.parse(pair);
      emptyCategories.push({
        industry_id: industryKey ? dimensionId("industry", industryKey, UNKNOWN_INDUSTRY) : null,
        industry: industryKey,
        product_category_id: entry.id || dimensionId("category", categoryKey, UNKNOWN_PRODUCT_CATEGORY),
        product_category: categoryKey,
        product_category_zh: entry.zh || DEFAULT_ZH,
        record_count: 0,
      });
    }
  }
  const categoryParentCollisions = [...registry.categoryParents.entries()]
    .filter(([, parents]) => parents.size > 1)
    .map(([category, parents]) => ({
      product_category: category,
      parent_industries: [...parents].sort((a, b) => a.localeCompare(b, "en")),
      status: "pending_manual",
    }))
    .sort((a, b) => a.product_category.localeCompare(b.product_category, "en"));
  return {
    registry_industry_count: registry.industries.size,
    registry_category_count: registry.categories.size,
    empty_industry_count: emptyIndustries.length,
    empty_category_count: emptyCategories.length,
    category_parent_collision_count: categoryParentCollisions.length,
    category_parent_collisions: categoryParentCollisions,
    empty_industries: emptyIndustries.sort((a, b) => a.industry.localeCompare(b.industry, "en")),
    empty_categories: emptyCategories.sort((a, b) => String(a.product_category).localeCompare(String(b.product_category), "en")),
  };
}

function resolveOptions(options = {}) {
  const nested = options.filters && typeof options.filters === "object" ? options.filters : {};
  const industryFilter = options.industry ?? options.industryFilter ?? nested.industry ?? nested.industryFilter;
  const categoryFilter = options.product_category
    ?? options.productCategory
    ?? options.category
    ?? options.categoryFilter
    ?? nested.product_category
    ?? nested.productCategory
    ?? nested.category
    ?? nested.categoryFilter;
  const thresholdCandidate = options.low_frequency_threshold
    ?? options.lowFrequencyThreshold
    ?? 10;
  const threshold = Number(thresholdCandidate);
  const scope = text(options.scope ?? options.source_scope ?? options.sourceScope) || "all";
  return {
    industryFilter: filterSet(industryFilter, UNKNOWN_INDUSTRY),
    categoryFilter: filterSet(categoryFilter, UNKNOWN_PRODUCT_CATEGORY),
    includeBlacklisted: options.include_blacklisted === true || options.includeBlacklisted === true,
    includeUnknown: options.include_unknown !== false && options.includeUnknown !== false,
    scope,
    sourceSites: sourceFilterSet(options.source_sites ?? options.sourceSites ?? options.source_site ?? options.sourceSite),
    sourcePlatforms: sourceFilterSet(options.source_platforms ?? options.sourcePlatforms ?? options.source_platform ?? options.sourcePlatform),
    taxonomy: options.taxonomy || options.state?.taxonomy || null,
    state: options.state || null,
    registry: options.registry || null,
    lowFrequencyThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 10,
    isDeliverable: typeof options.isDeliverable === "function"
      ? options.isDeliverable
      : typeof options.deliverablePredicate === "function"
        ? options.deliverablePredicate
        : isDeliverableRecord,
  };
}

/**
 * Aggregate records into category rows, industry subtotals and a grand total.
 * The input may be a `videos` array or the complete bootstrap state object.
 * No input object is mutated.
 */
export function buildLibraryStatistics(input, options = {}) {
  const sourceVideos = extractVideos(input);
  const resolved = resolveOptions(options);
  const registry = buildDimensionRegistry(input, {
    ...options,
    state: options.state || (!Array.isArray(input) ? input : null),
    taxonomy: options.taxonomy || options.state?.taxonomy || (!Array.isArray(input) ? input?.taxonomy : null),
  });
  const grouped = new Map();
  const industryGroups = new Map();
  const durationGroups = new Map(DURATION_BANDS.map((band) => [band.key, mutableAggregate()]));
  const selectedIndices = new Set();
  let excludedBlacklistedCount = 0;
  let excludedFilterCount = 0;
  let excludedSourceCount = 0;
  let excludedUnknownCount = 0;

  for (const [index, video] of sourceVideos.entries()) {
    if (!sourceMatches(video, resolved)) {
      excludedSourceCount += 1;
      continue;
    }
    if (!resolved.includeBlacklisted && blacklisted(video)) {
      excludedBlacklistedCount += 1;
      continue;
    }
    const { industry, productCategory } = dimensionsForVideo(video, registry);
    if (!matchesFilter(industry, resolved.industryFilter)
      || !matchesFilter(productCategory, resolved.categoryFilter)) {
      excludedFilterCount += 1;
      continue;
    }
    if (!resolved.includeUnknown && (industry.key === null || productCategory.key === null)) {
      excludedUnknownCount += 1;
      continue;
    }

    selectedIndices.add(index);
    const groupKey = JSON.stringify([industry.key, productCategory.key]);
    if (!grouped.has(groupKey)) grouped.set(groupKey, {
      industry,
      productCategory,
      aggregate: mutableAggregate(),
    });
    addRecord(grouped.get(groupKey).aggregate, video, index, {
      isDeliverable: resolved.isDeliverable,
      industry,
      productCategory,
      registry,
    });

    const industryKey = JSON.stringify(industry.key);
    if (!industryGroups.has(industryKey)) industryGroups.set(industryKey, {
      industry,
      aggregate: mutableAggregate(),
      durationGroups: new Map(DURATION_BANDS.map((band) => [band.key, mutableAggregate()])),
    });
    const industryGroup = industryGroups.get(industryKey);
    addRecord(industryGroup.aggregate, video, index, {
      isDeliverable: resolved.isDeliverable,
      industry,
      productCategory,
      registry,
    });
    addRecord(industryGroup.durationGroups.get(durationBand(durationSeconds(video))), video, index, {
      isDeliverable: resolved.isDeliverable,
      industry,
      productCategory,
      registry,
    });

    addRecord(durationGroups.get(durationBand(durationSeconds(video))), video, index, {
      isDeliverable: resolved.isDeliverable,
      industry,
      productCategory,
      registry,
    });
  }

  const categoryRows = [...grouped.values()]
    .map(({ industry, productCategory, aggregate }) => rowFromAggregate({
      rowType: "category",
      industry,
      productCategory,
      aggregate,
      lowFrequencyThreshold: resolved.lowFrequencyThreshold,
    }))
    .sort(sortRows);
  const industryRows = [...industryGroups.values()]
    .map(({ industry, aggregate }) => rowFromAggregate({
      rowType: "industry_total",
      industry,
      productCategory: null,
      aggregate,
      lowFrequencyThreshold: resolved.lowFrequencyThreshold,
    }))
    .sort(sortRows);
  const durationRows = DURATION_BANDS.map((band) => durationRowFromAggregate({
    band,
    aggregate: durationGroups.get(band.key),
    lowFrequencyThreshold: resolved.lowFrequencyThreshold,
  }));
  const durationRowsByIndustry = [...industryGroups.values()]
    .map(({ industry, durationGroups: groupedDurations }) => ({
      industry_id: industry.id || dimensionId("industry", industry.key, UNKNOWN_INDUSTRY),
      industry_key: industry.key,
      industry: industry.label,
      industry_zh: industry.zh || DEFAULT_ZH,
      industry_raw_values: [...new Set(DURATION_BANDS.flatMap((band) => (
        groupedDurations.get(band.key).industry_raw_values
          ? [...groupedDurations.get(band.key).industry_raw_values]
          : []
      )))].sort(),
      rows: DURATION_BANDS.map((band) => durationRowFromAggregate({
        band,
        aggregate: groupedDurations.get(band.key),
        lowFrequencyThreshold: resolved.lowFrequencyThreshold,
        industry,
      })),
    }))
    .sort((left, right) => String(left.industry).localeCompare(String(right.industry), "en", { sensitivity: "base" }));

  const totalAggregate = mutableAggregate();
  for (const [index, video] of sourceVideos.entries()) {
    if (!selectedIndices.has(index)) continue;
    const { industry, productCategory } = dimensionsForVideo(video, registry);
    addRecord(totalAggregate, video, index, {
      isDeliverable: resolved.isDeliverable,
      industry,
      productCategory,
      registry,
    });
  }
  const totalRow = rowFromAggregate({
    rowType: "grand_total",
    industry: { key: null, label: "全库总计", zh: "全库总计", id: "industry:all", raw: null },
    productCategory: null,
    aggregate: totalAggregate,
    lowFrequencyThreshold: resolved.lowFrequencyThreshold,
  });

  // Keep a useful hierarchical order for spreadsheet consumers while also
  // exposing each level independently for callers that need a pivot view.
  const rows = [];
  for (const industryRow of industryRows) {
    rows.push(...categoryRows.filter((row) => row.industry === industryRow.industry));
    rows.push(industryRow);
  }
  rows.push(totalRow);

  const filters = {
    industry: resolved.industryFilter ? [...resolved.industryFilter] : null,
    product_category: resolved.categoryFilter ? [...resolved.categoryFilter] : null,
    include_blacklisted: resolved.includeBlacklisted,
    include_unknown: resolved.includeUnknown,
    scope: resolved.scope,
    source_sites: resolved.sourceSites ? [...resolved.sourceSites] : null,
    source_platforms: resolved.sourcePlatforms ? [...resolved.sourcePlatforms] : null,
  };
  const sourceBreakdown = { ...totalRow.source_breakdown };
  const sourceBreakdownBeforeExclusions = {};
  const sourceStatusCounts = {
    pending_review: 0,
    approved: 0,
    core_template_eligible: 0,
    excluded: 0,
    blacklisted: 0,
  };
  const sourceStatusCountsBeforeExclusions = {
    pending_review: 0,
    approved: 0,
    core_template_eligible: 0,
    excluded: 0,
    blacklisted: 0,
  };
  for (const [index, video] of sourceVideos.entries()) {
    if (!sourceMatches(video, resolved)) continue;
    const source = sourceKey(video);
    sourceBreakdownBeforeExclusions[source] = (sourceBreakdownBeforeExclusions[source] || 0) + 1;
    if (selectedIndices.has(index)) {
      if (pendingReview(video)) sourceStatusCounts.pending_review += 1;
      if (approved(video)) sourceStatusCounts.approved += 1;
      if (video?.core_template_eligible === true) sourceStatusCounts.core_template_eligible += 1;
      if (excluded(video)) sourceStatusCounts.excluded += 1;
      if (blacklisted(video)) sourceStatusCounts.blacklisted += 1;
    }
    if (pendingReview(video)) sourceStatusCountsBeforeExclusions.pending_review += 1;
    if (approved(video)) sourceStatusCountsBeforeExclusions.approved += 1;
    if (video?.core_template_eligible === true) sourceStatusCountsBeforeExclusions.core_template_eligible += 1;
    if (excluded(video)) sourceStatusCountsBeforeExclusions.excluded += 1;
    if (blacklisted(video)) sourceStatusCountsBeforeExclusions.blacklisted += 1;
  }
  return {
    version: "library-statistics-v1",
    scope: resolved.scope,
    scope_id: resolved.scope,
    generated_at: options.generated_at || options.generatedAt || null,
    state_sha256: options.state_sha256 || options.stateSha256 || null,
    taxonomy_version: registry.taxonomy?.version || null,
    methodology_version: options.methodology_version
      || options.methodologyVersion
      || options.methodology?.version
      || options.state?.methodology?.version
      || (!Array.isArray(input) ? input?.methodology?.version : null)
      || null,
    count_unit: "records",
    classification_state: "confirmed_fields_with_candidate_diagnostics",
    contract_metadata: {
      state_version: options.state_version || options.state?.version || (!Array.isArray(input) ? input?.version : null),
      state_sha256: options.state_sha256 || options.stateSha256 || null,
      taxonomy_version: registry.taxonomy?.version || null,
      methodology_version: options.methodology_version
        || options.methodologyVersion
        || options.methodology?.version
        || options.state?.methodology?.version
        || (!Array.isArray(input) ? input?.methodology?.version : null)
        || null,
    },
    duration_bands: DURATION_BANDS.map((band) => ({ ...band })),
    low_frequency_threshold: resolved.lowFrequencyThreshold,
    filters,
    source_record_count: sourceVideos.length,
    filtered_record_count: selectedIndices.size,
    excluded_blacklisted_count: excludedBlacklistedCount,
    excluded_filter_count: excludedFilterCount,
    excluded_source_count: excludedSourceCount,
    excluded_unknown_count: excludedUnknownCount,
    excluded_total_count: excludedBlacklistedCount + excludedFilterCount + excludedSourceCount + excludedUnknownCount,
    source_breakdown: sourceBreakdown,
    source_breakdown_before_exclusions: sourceBreakdownBeforeExclusions,
    source_status_counts: sourceStatusCounts,
    source_status_counts_before_exclusions: sourceStatusCountsBeforeExclusions,
    source_filter: {
      scope: resolved.scope,
      source_sites: resolved.sourceSites ? [...resolved.sourceSites] : null,
      source_platforms: resolved.sourcePlatforms ? [...resolved.sourcePlatforms] : null,
    },
    registry_diagnostics: registryDiagnostics(registry, industryRows, categoryRows),
    category_rows: categoryRows,
    industry_rows: industryRows,
    duration_rows: durationRows,
    duration_rows_by_industry: durationRowsByIndustry,
    rows,
    total: totalRow,
    totals: totalRow,
  };
}

export const aggregateLibraryStatistics = buildLibraryStatistics;
export const buildStatistics = buildLibraryStatistics;
export const getLibraryStatistics = buildLibraryStatistics;
export const buildSupplyStatistics = buildLibraryStatistics;

/** Return flat rows suitable for a spreadsheet or table component. */
export function toStatisticsRows(value, options = {}) {
  const includeCategoryRows = options.include_category_rows !== false && options.includeCategoryRows !== false;
  const includeIndustryRows = options.include_industry_totals !== false && options.includeIndustryTotals !== false;
  const includeGrandTotal = options.include_grand_total !== false && options.includeGrandTotal !== false;
  const includeDurationRows = options.include_duration_rows === true || options.includeDurationRows === true;
  if (Array.isArray(value)) return toStatisticsRows(buildLibraryStatistics(value, options), options);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.rows)) {
    const rows = value.rows.filter((row) => (
      (row.row_type === "category" && includeCategoryRows)
      || (row.row_type === "industry_total" && includeIndustryRows)
      || (row.row_type === "grand_total" && includeGrandTotal)
    )).map((row) => ({ ...row, duration_bands: { ...row.duration_bands } }));
    if (includeDurationRows && Array.isArray(value.duration_rows)) {
      rows.push(...value.duration_rows.map((row) => ({ ...row, duration_bands: { ...row.duration_bands } })));
    }
    return rows;
  }
  const rows = [];
  if (includeCategoryRows && Array.isArray(value.category_rows)) rows.push(...value.category_rows);
  if (includeIndustryRows && Array.isArray(value.industry_rows)) rows.push(...value.industry_rows);
  if (includeDurationRows && Array.isArray(value.duration_rows)) rows.push(...value.duration_rows);
  if (includeGrandTotal && value.total) rows.push(value.total);
  return rows.map((row) => ({ ...row, duration_bands: { ...row.duration_bands } }));
}

export const statisticsRows = toStatisticsRows;

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeDelimited(value, delimiter) {
  const stringValue = csvValue(value);
  if (!stringValue.includes('"') && !stringValue.includes("\n") && !stringValue.includes("\r") && !stringValue.includes(delimiter)) {
    return stringValue;
  }
  return `"${stringValue.replaceAll('"', '""')}"`;
}

/** Serialize statistics rows as RFC-4180-compatible CSV or delimiter TSV. */
export function serializeStatisticsRows(value, options = {}) {
  const format = String(options.format || options.type || "csv").toLowerCase();
  const delimiter = options.delimiter || (format === "tsv" ? "\t" : ",");
  if (delimiter.length !== 1) throw new TypeError("delimiter must be one character");
  const columns = Array.isArray(options.columns) && options.columns.length
    ? options.columns
    : STATISTICS_COLUMNS;
  const rows = Array.isArray(value)
    ? (value.length === 0 || value.every((row) => row && typeof row === "object" && row.row_type)
      ? value
      : toStatisticsRows(value, options))
    : toStatisticsRows(value, options);
  const includeHeader = options.include_header !== false && options.includeHeader !== false;
  const lines = [];
  if (includeHeader) lines.push(columns.map((column) => escapeDelimited(column, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(columns.map((column) => escapeDelimited(row?.[column], delimiter)).join(delimiter));
  }
  return lines.join(options.line_ending || "\n");
}

export const serializeRows = serializeStatisticsRows;
export const toDelimited = serializeStatisticsRows;
export const serializeStatistics = serializeStatisticsRows;
