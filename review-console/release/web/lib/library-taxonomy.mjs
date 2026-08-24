const DEFAULT_UNCLASSIFIED_INDUSTRIES = ["Other", "Unclassified", "跨行业 / 方法参考"];
const CONFIRMED_CLASSIFICATION_STATUSES = new Set(["source_verified", "visual_verified", "human_confirmed"]);
const CANDIDATE_CLASSIFICATION_STATUSES = new Set([
  "candidate",
  "mapped_candidate",
  "pending_category_review",
  "pending_manual",
  "pending_review",
]);
const GENERIC_CATEGORY_PATTERN = /^general\b/i;

export const DEFAULT_LONG_TAIL_THRESHOLD = 10;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function registryIndustry(entry) {
  if (typeof entry === "string") return text(entry);
  return text(entry?.industry);
}

function candidateIndustryValues(video = {}) {
  const values = [
    video.industry_candidate,
    video.classification_candidate?.industry,
    ...(Array.isArray(video.industry_candidates) ? video.industry_candidates : []),
    ...(Array.isArray(video.classification_candidate?.alternatives)
      ? video.classification_candidate.alternatives.map((alternative) =>
        typeof alternative === "string" ? alternative : alternative?.industry
      )
      : []),
  ];
  return [...new Set(values.map(text).filter(Boolean))];
}

function productCategoryValues(video = {}) {
  return [video.product_category].map(text).filter(Boolean);
}

function manualClassificationConfirmed(video = {}) {
  return (Array.isArray(video.review_events) ? video.review_events : []).some((event) => {
    if (event?.action !== "classification_update") return false;
    const before = event.before && typeof event.before === "object" ? event.before : {};
    const after = event.after && typeof event.after === "object" ? event.after : {};
    return ["industry", "product_category"].some((field) => (
      Object.hasOwn(after, field) && text(after[field]) !== text(before[field])
    ));
  });
}

function candidateOnlyClassification(video = {}) {
  if (manualClassificationConfirmed(video)) return false;
  const candidate = video.classification_candidate;
  const status = text(
    video.classification_review_status
    || candidate?.classification_review_status
    || candidate?.status,
  );
  if (CONFIRMED_CLASSIFICATION_STATUSES.has(status)) return false;
  return CANDIDATE_CLASSIFICATION_STATUSES.has(status)
    || candidate?.source_needs_manual === true
    || candidate?.registry_unresolved === true
    || (candidate?.conflict_status && candidate.conflict_status !== "none")
    || productCategoryValues(video).some((value) => GENERIC_CATEGORY_PATTERN.test(value));
}

function categoryMatchesRule(video, rule) {
  const categories = new Set(productCategoryValues(video));
  return (rule.when_categories || []).some((category) => categories.has(text(category)));
}

/**
 * Resolve an industry through the canonical taxonomy supplied by the caller.
 * Conditional rules are applied only when the record contains matching
 * product-category evidence; unresolved conditional values remain unchanged.
 */
export function canonicalIndustry(value, { taxonomy = {}, video = {} } = {}) {
  let current = text(value);
  if (!current) return "";

  const conditionalRules = Array.isArray(taxonomy.conditional_industry_rules)
    ? taxonomy.conditional_industry_rules
    : [];
  const conditionalRule = conditionalRules.find((rule) =>
    text(rule?.from) === current && categoryMatchesRule(video, rule)
  );
  if (conditionalRule?.to) current = text(conditionalRule.to);

  const aliases = taxonomy.canonical_industry_aliases && typeof taxonomy.canonical_industry_aliases === "object"
    ? taxonomy.canonical_industry_aliases
    : {};
  const seen = new Set();
  while (aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = text(aliases[current]);
  }
  return current;
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedCounts(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function registryMap(entries, taxonomy) {
  const map = new Map();
  for (const entry of entries || []) {
    const raw = registryIndustry(entry);
    if (!raw) continue;
    const canonical = canonicalIndustry(raw, { taxonomy });
    if (!canonical || map.has(canonical)) continue;
    map.set(canonical, {
      ...(typeof entry === "object" && entry ? entry : {}),
      industry: canonical,
      raw_industry: raw,
    });
  }
  return map;
}

/**
 * Build the product-facing industry option model without mutating input data.
 *
 * Only confirmed `video.industry` values contribute to an option count.
 * Candidate-only values are returned as diagnostics and never become options.
 * Registry entries with no confirmed records are omitted from options.
 */
export function buildIndustryOptionModel({
  videos = [],
  industries = [],
  taxonomy = {},
  longTailThreshold = DEFAULT_LONG_TAIL_THRESHOLD,
  unclassifiedIndustries = DEFAULT_UNCLASSIFIED_INDUSTRIES,
} = {}) {
  const threshold = Number.isFinite(Number(longTailThreshold)) && Number(longTailThreshold) > 0
    ? Number(longTailThreshold)
    : DEFAULT_LONG_TAIL_THRESHOLD;
  const reserved = new Set((unclassifiedIndustries || []).map(text).filter(Boolean));
  const registry = registryMap(industries, taxonomy);
  const confirmedCounts = new Map();
  const categoryCounts = new Map();
  const candidateOnlyCounts = new Map();
  const unregisteredCounts = new Map();
  const reservedCounts = new Map();
  let emptyCount = 0;
  let candidateOnlyRecordCount = 0;

  for (const video of Array.isArray(videos) ? videos : []) {
    const rawIndustry = text(video?.industry);
    if (candidateOnlyClassification(video)) {
      if (!rawIndustry) emptyCount += 1;
      candidateOnlyRecordCount += 1;
      const candidates = [...new Set([rawIndustry, ...candidateIndustryValues(video)].filter(Boolean))];
      for (const candidate of candidates) addCount(candidateOnlyCounts, canonicalIndustry(candidate, { taxonomy, video }));
      continue;
    }
    if (!rawIndustry) {
      emptyCount += 1;
      const candidates = candidateIndustryValues(video);
      if (candidates.length) candidateOnlyRecordCount += 1;
      for (const candidate of candidates) addCount(candidateOnlyCounts, canonicalIndustry(candidate, { taxonomy, video }));
      continue;
    }

    const industry = canonicalIndustry(rawIndustry, { taxonomy, video });
    if (!industry) {
      emptyCount += 1;
      continue;
    }
    if (reserved.has(industry)) {
      addCount(reservedCounts, industry);
      continue;
    }
    if (!registry.has(industry)) {
      addCount(unregisteredCounts, industry);
      continue;
    }

    addCount(confirmedCounts, industry);
    const categories = new Set(productCategoryValues(video));
    if (categories.size) {
      const perIndustry = categoryCounts.get(industry) || new Map();
      for (const category of categories) addCount(perIndustry, category);
      categoryCounts.set(industry, perIndustry);
    }
  }

  const options = sortedCounts(confirmedCounts).map(({ value, count }) => {
    const meta = registry.get(value) || {};
    const tier = count < threshold ? "long_tail" : "active";
    const categories = categoryCounts.get(value) || new Map();
    return {
      value,
      industry: value,
      label: value,
      zh: text(meta.zh) || null,
      priority: text(meta.priority) || null,
      count,
      record_count: count,
      category_count: categories.size,
      tier,
      is_long_tail: tier === "long_tail",
      candidate_only: false,
    };
  });

  const omittedRegistry = [...registry.values()]
    .filter((entry) => !confirmedCounts.has(entry.industry))
    .map((entry) => ({
      value: entry.industry,
      label: entry.industry,
      zh: text(entry.zh) || null,
      priority: text(entry.priority) || null,
      count: 0,
      reason: reserved.has(entry.industry) ? "reserved_unclassified" : "no_confirmed_records",
    }))
    .sort((left, right) => left.value.localeCompare(right.value));

  const active = options.filter((option) => option.tier === "active");
  const longTail = options.filter((option) => option.tier === "long_tail");
  const candidateOnly = sortedCounts(candidateOnlyCounts).map((entry) => ({
    ...entry,
    reason: "candidate_only",
  }));
  const unregistered = sortedCounts(unregisteredCounts).map((entry) => ({
    ...entry,
    reason: "unregistered_confirmed",
  }));
  const reservedValues = sortedCounts(reservedCounts).map((entry) => ({
    ...entry,
    reason: "reserved_unclassified",
  }));
  const unclassified = {
    count: (Array.isArray(videos) ? videos.length : 0) - options.reduce((sum, option) => sum + option.count, 0),
    empty_count: emptyCount,
    candidate_only_record_count: candidateOnlyRecordCount,
    candidate_only_count: candidateOnly.reduce((sum, entry) => sum + entry.count, 0),
    unregistered_confirmed_count: unregistered.reduce((sum, entry) => sum + entry.count, 0),
    reserved_count: reservedValues.reduce((sum, entry) => sum + entry.count, 0),
    candidate_only: candidateOnly,
    unregistered,
    reserved: reservedValues,
  };

  return {
    threshold,
    total_count: Array.isArray(videos) ? videos.length : 0,
    classified_count: options.reduce((sum, option) => sum + option.count, 0),
    active_count: active.reduce((sum, option) => sum + option.count, 0),
    long_tail_count: longTail.reduce((sum, option) => sum + option.count, 0),
    options,
    active,
    long_tail: longTail,
    omitted_registry: omittedRegistry,
    unclassified,
  };
}

export function industryOptionsForData(data = {}, options = {}) {
  return buildIndustryOptionModel({
    ...options,
    videos: options.videos ?? data.videos,
    industries: options.industries ?? data.industries,
    taxonomy: options.taxonomy ?? data.taxonomy ?? {},
  });
}
