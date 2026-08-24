const DEFAULT_FORMAL_SOURCE_IDS = Object.freeze([
  "ads_of_the_world",
  "best_ads",
  "stash",
]);

const RESERVED_EXACT_VALUES = new Set([
  "",
  "other",
  "unclassified",
  "unknown",
  "n/a",
  "na",
  "tbd",
  "待确认",
  "待确认行业",
  "待确认品类",
  "其他",
  "未分类",
]);

const MANUAL_STATUS_PATTERN = /(pending|manual|conflict|unresolved|needs?[_ -]?review)/i;
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low", "none"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function token(value) {
  return text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function uniqueStrings(items) {
  return [...new Set(items.map(text).filter(Boolean))];
}

function firstText(...items) {
  for (const item of items) {
    const value = text(item);
    if (value) return value;
  }
  return "";
}

function firstArray(...items) {
  return items.find(Array.isArray) || [];
}

function sourceId(video) {
  return firstText(video?.source_site, video?.source_platform).toLowerCase();
}

function videoId(video, index = 0) {
  return firstText(video?.video_id, video?.id) || `record-index:${index}`;
}

function normalizeConfidence(value, fallback) {
  const normalized = token(value).replace(/[_ -]?candidate$/, "");
  if (CONFIDENCE_LEVELS.has(normalized)) return normalized;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return "high";
    if (numeric >= 0.5) return "medium";
    return "low";
  }
  return fallback;
}

function isReserved(value, taxonomy = {}) {
  const normalized = token(value);
  const forbidden = array(taxonomy?.registry_contract?.forbidden_formal_labels).map(token);
  return RESERVED_EXACT_VALUES.has(normalized)
    || forbidden.includes(normalized)
    || /^general(?:\s|$)/i.test(normalized)
    || /^通用(?:\s|$)/.test(normalized)
    || /（泛）$/.test(normalized);
}

function collectionCandidates(taxonomy, type) {
  const registry = taxonomy?.registry && typeof taxonomy.registry === "object" ? taxonomy.registry : {};
  const closedRegistry = taxonomy?.closed_registry && typeof taxonomy.closed_registry === "object"
    ? taxonomy.closed_registry
    : {};
  if (type === "industry") {
    return [
      taxonomy?.industries,
      taxonomy?.industry_registry,
      taxonomy?.canonical_industries,
      registry.industries,
      registry.industry_registry,
      closedRegistry.industries,
    ];
  }
  return [
    taxonomy?.categories,
    taxonomy?.category_registry,
    taxonomy?.product_categories,
    taxonomy?.canonical_categories,
    registry.categories,
    registry.product_categories,
    closedRegistry.categories,
    closedRegistry.product_categories,
  ];
}

function collectionEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, entry]) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? { registry_key: key, ...entry }
      : { registry_key: key, name_en: entry }
  ));
}

function industryName(entry) {
  if (typeof entry === "string") return text(entry);
  return firstText(
    entry?.name_en,
    entry?.industry,
    entry?.canonical_name,
    entry?.label_en,
    entry?.name,
    entry?.value,
    entry?.key,
  );
}

function categoryName(entry) {
  if (typeof entry === "string") return text(entry);
  return firstText(
    entry?.name_en,
    entry?.product_category,
    entry?.category,
    entry?.canonical_name,
    entry?.label_en,
    entry?.name,
    entry?.value,
    entry?.key,
  );
}

function bilingualName(entry, fallback) {
  return {
    name_en: fallback,
    name_zh: firstText(entry?.name_zh, entry?.label_zh, entry?.zh) || null,
  };
}

function addIndex(index, value, entry) {
  const key = token(value);
  if (!key) return;
  const entries = index.get(key) || [];
  if (!entries.includes(entry)) entries.push(entry);
  index.set(key, entries);
}

function industryReferenceTokens(entry) {
  return uniqueStrings([
    entry.id,
    entry.name_en,
    entry.name_zh,
    ...array(entry.aliases),
  ]);
}

function categoryReferenceTokens(entry) {
  return uniqueStrings([
    entry.id,
    entry.name_en,
    entry.name_zh,
    ...array(entry.aliases),
  ]);
}

function categoryCollectionsFromIndustry(entry) {
  if (!entry || typeof entry !== "object") return [];
  return [
    entry.categories,
    entry.product_categories,
    entry.category_registry,
    entry.children,
  ].flatMap(collectionEntries);
}

function categoryParentReferences(entry, nestedParent = null) {
  const direct = [
    entry?.parent_industry_id,
    entry?.industry_id,
    entry?.parent_id,
    entry?.parent_industry,
    entry?.industry,
    nestedParent?.id,
  ];
  const plural = [
    ...array(entry?.parent_industry_ids),
    ...array(entry?.industry_ids),
    ...array(entry?.parents),
  ].map((value) => (value && typeof value === "object"
    ? firstText(value.id, value.parent_industry_id, value.industry_id, value.name_en, value.name)
    : value));
  return uniqueStrings([...direct, ...plural]);
}

function taxonomyRegistryMode(taxonomy) {
  return token(
    taxonomy?.registry_mode
      ?? taxonomy?.registry_contract?.mode
      ?? taxonomy?.registry?.mode
      ?? taxonomy?.closed_registry?.mode
      ?? taxonomy?.contract?.registry_mode,
  );
}

function taxonomyVersion(taxonomy) {
  return firstText(taxonomy?.taxonomy_version, taxonomy?.version, taxonomy?.schema_version) || null;
}

/**
 * Parse the v3 taxonomy into a closed, two-level registry. The parser accepts
 * both nested and flat registry layouts so contract revisions do not weaken
 * the governance gate.
 */
export function parseTaxonomyRegistry(taxonomy = {}) {
  const mode = taxonomyRegistryMode(taxonomy);
  if (mode !== "closed") {
    throw new Error("taxonomy registry_mode must be closed");
  }

  const industries = [];
  const industryIdentity = new Map();
  for (const collection of collectionCandidates(taxonomy, "industry")) {
    for (const rawEntry of collectionEntries(collection)) {
      const entry = typeof rawEntry === "string" ? { name_en: rawEntry } : rawEntry;
      const name = industryName(entry);
      const id = firstText(entry?.id, entry?.industry_id, entry?.registry_key);
      if (!name || !id) continue;
      const identity = token(id);
      let normalized = industryIdentity.get(identity);
      if (!normalized) {
        normalized = {
          id,
          ...bilingualName(entry, name),
          aliases: uniqueStrings(array(entry?.aliases)),
          conflict_status: firstText(entry?.conflict_status, entry?.status).toLowerCase() || null,
          source: entry,
        };
        industryIdentity.set(identity, normalized);
        industries.push(normalized);
      } else {
        normalized.aliases = uniqueStrings([...normalized.aliases, ...array(entry?.aliases)]);
      }
    }
  }
  if (!industries.length) throw new Error("closed taxonomy has no industry registry entries");

  const industryIndex = new Map();
  for (const entry of industries) {
    for (const reference of industryReferenceTokens(entry)) addIndex(industryIndex, reference, entry);
  }

  const pendingCategories = [];
  for (const collection of collectionCandidates(taxonomy, "industry")) {
    for (const rawIndustry of collectionEntries(collection)) {
      if (!rawIndustry || typeof rawIndustry !== "object") continue;
      const industryMatches = industryIndex.get(token(firstText(
        rawIndustry.id,
        rawIndustry.industry_id,
        rawIndustry.registry_key,
        industryName(rawIndustry),
      ))) || [];
      const nestedParent = industryMatches.length === 1 ? industryMatches[0] : null;
      for (const category of categoryCollectionsFromIndustry(rawIndustry)) {
        pendingCategories.push({ entry: category, nestedParent });
      }
    }
  }
  for (const collection of collectionCandidates(taxonomy, "category")) {
    for (const entry of collectionEntries(collection)) pendingCategories.push({ entry, nestedParent: null });
  }

  const categoriesByIdentity = new Map();
  for (const pending of pendingCategories) {
    const rawEntry = pending.entry;
    const entry = typeof rawEntry === "string" ? { name_en: rawEntry } : rawEntry;
    const name = categoryName(entry);
    if (!name) continue;
    const declaredId = firstText(entry?.id, entry?.category_id, entry?.product_category_id, entry?.registry_key);
    const identity = token(declaredId || name);
    const parentReferences = categoryParentReferences(entry, pending.nestedParent);
    const resolvedParentIds = new Set();
    const invalidParentReferences = [];
    for (const reference of parentReferences) {
      const matches = industryIndex.get(token(reference)) || [];
      if (matches.length === 1) resolvedParentIds.add(matches[0].id);
      else invalidParentReferences.push(reference);
    }
    let normalized = categoriesByIdentity.get(identity);
    if (!normalized) {
      normalized = {
        id: declaredId || null,
        ...bilingualName(entry, name),
        aliases: uniqueStrings(array(entry?.aliases)),
        parent_industry_ids: resolvedParentIds,
        invalid_parent_references: new Set(invalidParentReferences),
        conflict_status: firstText(entry?.conflict_status, entry?.status).toLowerCase() || null,
        source: entry,
      };
      categoriesByIdentity.set(identity, normalized);
    } else {
      for (const parentId of resolvedParentIds) normalized.parent_industry_ids.add(parentId);
      for (const reference of invalidParentReferences) normalized.invalid_parent_references.add(reference);
      normalized.aliases = uniqueStrings([...normalized.aliases, ...array(entry?.aliases)]);
    }
  }
  const categories = [...categoriesByIdentity.values()];
  if (!categories.length) throw new Error("closed taxonomy has no product category registry entries");

  const categoryIndex = new Map();
  for (const entry of categories) {
    for (const reference of categoryReferenceTokens(entry)) addIndex(categoryIndex, reference, entry);
  }

  return {
    mode,
    version: taxonomyVersion(taxonomy),
    industries,
    categories,
    industry_index: industryIndex,
    category_index: categoryIndex,
    invalid_categories: categories.filter((entry) => (
      entry.parent_industry_ids.size !== 1 || entry.invalid_parent_references.size > 0
    )),
  };
}

function targetFromRule(rule, dimension) {
  if (typeof rule === "string") return rule;
  if (!rule || typeof rule !== "object") return "";
  return dimension === "industry"
    ? firstText(
      rule.to_industry_id,
      rule.target_industry_id,
      rule.to_industry,
      rule.target_industry,
      rule.to_id,
      rule.target_id,
      rule.to,
      rule.target,
      rule.canonical,
    )
    : firstText(
      rule.to_product_category_id,
      rule.target_product_category_id,
      rule.to_category_id,
      rule.target_category_id,
      rule.to_product_category,
      rule.target_product_category,
      rule.to_category,
      rule.target_category,
      rule.to_id,
      rule.target_id,
      rule.to,
      rule.target,
      rule.canonical,
    );
}

function addRule(ruleMap, from, to, metadata = {}) {
  const key = token(from);
  if (!key || !text(to)) return;
  const list = ruleMap.get(key) || [];
  const next = {
    from: text(from),
    to: text(to),
    rule_id: firstText(metadata.rule_id, metadata.id) || null,
    evidence: firstText(metadata.evidence, metadata.reason, metadata.note) || null,
    confidence: normalizeConfidence(metadata.confidence, "medium"),
    status: firstText(metadata.status).toLowerCase() || null,
    conditional_categories: uniqueStrings(firstArray(metadata.when_categories, metadata.categories)),
  };
  if (!list.some((item) => item.to === next.to && item.rule_id === next.rule_id)) list.push(next);
  ruleMap.set(key, list);
}

function addRuleObject(ruleMap, object, dimension) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return;
  for (const [from, definition] of Object.entries(object)) {
    if (typeof definition === "string") addRule(ruleMap, from, definition);
    else addRule(ruleMap, from, targetFromRule(definition, dimension), definition);
  }
}

function addRuleArray(ruleMap, entries, dimension) {
  for (const rule of array(entries)) {
    if (!rule || typeof rule !== "object") continue;
    const declaredDimension = token(rule.dimension ?? rule.field ?? rule.type);
    if (declaredDimension) {
      const isIndustry = declaredDimension.includes("industry");
      const isCategory = declaredDimension.includes("category") || declaredDimension.includes("product");
      if ((dimension === "industry" && !isIndustry) || (dimension === "category" && !isCategory)) continue;
    }
    const from = dimension === "industry"
      ? firstText(rule.from_industry_id, rule.from_industry, rule.from_id, rule.from, rule.source)
      : firstText(
        rule.from_product_category_id,
        rule.from_category_id,
        rule.from_product_category,
        rule.from_category,
        rule.from_id,
        rule.from,
        rule.source,
      );
    addRule(ruleMap, from, targetFromRule(rule, dimension), rule);
  }
}

function migrationRoots(taxonomy) {
  return [
    taxonomy,
    taxonomy?.legacy_category_mappings,
    taxonomy?.migration,
    taxonomy?.migrations,
    taxonomy?.migration_from_v2,
    taxonomy?.migration_rules,
    taxonomy?.legacy_mappings,
  ].filter((value) => value && typeof value === "object");
}

function migrationRules(taxonomy, dimension) {
  const result = new Map();
  const objectKeys = dimension === "industry"
    ? [
      "canonical_industry_aliases",
      "legacy_industry_aliases",
      "industry_aliases",
      "industries",
      "industry_mappings",
    ]
    : [
      "safe_aliases",
      "category_aliases",
      "legacy_category_aliases",
      "legacy_product_category_aliases",
      "product_category_aliases",
      "categories",
      "product_categories",
      "category_mappings",
    ];
  const arrayKeys = dimension === "industry"
    ? ["industry_rules", "industry_migrations", "conditional_industry_rules"]
    : ["category_rules", "category_migrations", "product_category_rules", "product_category_migrations"];
  for (const root of migrationRoots(taxonomy)) {
    for (const key of objectKeys) addRuleObject(result, root?.[key], dimension);
    for (const key of arrayKeys) addRuleArray(result, root?.[key], dimension);
    addRuleArray(result, Array.isArray(root) ? root : root?.rules, dimension);
  }
  const aliases = taxonomy?.aliases;
  if (aliases && typeof aliases === "object") {
    addRuleObject(result, dimension === "industry" ? aliases.industries : aliases.categories, dimension);
    addRuleObject(result, dimension === "industry" ? aliases.industry : aliases.product_categories, dimension);
  }
  if (dimension === "industry") {
    for (const rule of array(taxonomy?.legacy_industry_manual_review)) {
      const from = firstText(rule?.label, rule?.from, rule?.source);
      for (const target of uniqueStrings(array(rule?.candidate_industry_ids))) {
        addRule(result, from, target, {
          ...rule,
          status: "manual_confirmation_required",
          evidence: firstText(rule?.reason, rule?.evidence),
        });
      }
    }
  } else {
    for (const rule of array(taxonomy?.legacy_product_category_manual_review)) {
      const from = firstText(rule?.label, rule?.from, rule?.source);
      for (const target of uniqueStrings(array(rule?.candidate_product_category_ids))) {
        addRule(result, from, target, {
          ...rule,
          status: "manual_confirmation_required",
          evidence: firstText(rule?.reason, rule?.evidence),
        });
      }
    }
    const categoryManualReview = taxonomy?.legacy_category_mappings?.manual_review;
    const entries = Array.isArray(categoryManualReview)
      ? categoryManualReview.map((rule) => [firstText(rule?.label, rule?.from, rule?.source), rule])
      : Object.entries(categoryManualReview || {});
    for (const [label, rule] of entries) {
      const from = firstText(label, rule?.label, rule?.from, rule?.source);
      const targets = uniqueStrings(firstArray(
        rule?.candidate_category_ids,
        rule?.candidate_product_category_ids,
        rule?.target_category_ids,
      ));
      for (const target of targets) {
        addRule(result, from, target, {
          ...rule,
          status: "manual_confirmation_required",
          evidence: firstText(rule?.reason, rule?.evidence),
        });
      }
    }
  }
  return result;
}

function ruleApplies(rule, categoryValues) {
  if (!rule.conditional_categories.length) return true;
  const lookup = new Set(categoryValues.map(token).filter(Boolean));
  return rule.conditional_categories.some((value) => lookup.has(token(value)));
}

function resolveDimension(rawValue, dimension, registry, rules, categoryValues = []) {
  const index = dimension === "industry" ? registry.industry_index : registry.category_index;
  const appliedRules = [];
  const visited = new Set();
  let current = text(rawValue);
  let ambiguousRule = false;
  for (let depth = 0; current && depth < 12; depth += 1) {
    const currentToken = token(current);
    if (visited.has(currentToken)) {
      ambiguousRule = true;
      break;
    }
    visited.add(currentToken);
    const matchingRules = (rules.get(currentToken) || []).filter((rule) => ruleApplies(rule, categoryValues));
    const targets = uniqueStrings(matchingRules.map((rule) => rule.to));
    if (!targets.length) break;
    if (targets.length > 1) {
      ambiguousRule = true;
      appliedRules.push(...matchingRules);
      break;
    }
    const selected = matchingRules.find((rule) => rule.to === targets[0]);
    appliedRules.push(selected);
    current = targets[0];
  }
  const matches = index.get(token(current)) || [];
  return {
    raw: text(rawValue),
    proposed: current || null,
    matches,
    rules: appliedRules,
    ambiguous_rule: ambiguousRule,
  };
}

function currentClassificationInputs(video) {
  const existing = video?.classification_candidate || {};
  return {
    industry: firstText(video?.industry, video?.industry_candidate, existing.industry),
    product_category: firstText(
      video?.product_category,
      video?.product_category_candidate,
      existing.product_category,
    ),
  };
}

function existingManualSignals(video) {
  const candidate = video?.classification_candidate || {};
  const normalization = video?.classification_normalization || {};
  const statusValues = [
    video?.classification_status,
    video?.taxonomy_status,
    video?.taxonomy_review_status,
    candidate.status,
    candidate.conflict_status,
    candidate.category_review_status,
    normalization.status,
    normalization.conflict_status,
    normalization.category_review_status,
  ].map(text).filter(Boolean);
  const reasons = [];
  if (statusValues.some((value) => MANUAL_STATUS_PATTERN.test(value))) reasons.push("existing_pending_or_manual_status");
  if (candidate.source_needs_manual === true || candidate.manual_review_required === true) reasons.push("existing_manual_review_flag");
  if (candidate.registry_unresolved === true || normalization.registry_unresolved === true) reasons.push("existing_registry_unresolved");
  if (array(normalization.parent_industry_options).length > 1) reasons.push("existing_parent_conflict");
  if (video?.classification_lock === true || video?.classification_lock?.locked === true) reasons.push("existing_classification_lock");
  return uniqueStrings(reasons);
}

function declaredTaxonomyConflict(taxonomy, valuesToCheck) {
  const conflicts = taxonomy?.category_parent_conflicts || taxonomy?.parent_conflicts || {};
  const manualConflicts = array(taxonomy?.manual_conflicts).map(token);
  const result = [];
  for (const value of valuesToCheck) {
    if (!value) continue;
    if (Object.hasOwn(conflicts, value)) result.push("taxonomy_parent_conflict");
    if (manualConflicts.includes(token(value))) result.push("taxonomy_manual_conflict");
  }
  return uniqueStrings(result);
}

function candidateValue(entry, type) {
  if (!entry) {
    return type === "industry"
      ? { industry_id: null, industry: null, industry_zh: null }
      : { product_category_id: null, product_category: null, product_category_zh: null };
  }
  return type === "industry"
    ? { industry_id: entry.id, industry: entry.name_en, industry_zh: entry.name_zh }
    : { product_category_id: entry.id, product_category: entry.name_en, product_category_zh: entry.name_zh };
}

function ruleAlternatives(resolution, dimension, registry) {
  const index = dimension === "industry" ? registry.industry_index : registry.category_index;
  const byIdentity = new Map();
  for (const target of uniqueStrings(resolution.rules.map((rule) => rule.to))) {
    const matches = index.get(token(target)) || [];
    if (!matches.length) {
      byIdentity.set(`unresolved:${target}`, {
        id: null,
        name: target,
        name_zh: null,
        parent_industry_ids: [],
        registry_resolved: false,
      });
      continue;
    }
    for (const entry of matches) {
      byIdentity.set(entry.id, {
        id: entry.id,
        name: entry.name_en,
        name_zh: entry.name_zh,
        parent_industry_ids: dimension === "category" ? [...entry.parent_industry_ids] : [],
        registry_resolved: true,
      });
    }
  }
  return [...byIdentity.values()];
}

function sourceRecordKey(video) {
  const source = sourceId(video);
  const recordIdValue = firstText(video?.source_record_id);
  return source && recordIdValue ? `${source}:${recordIdValue}` : null;
}

function campaignKey(video) {
  const source = sourceId(video);
  const campaignId = firstText(video?.campaign_id);
  if (campaignId) return `${source}:campaign:${campaignId}`;
  const recordKey = sourceRecordKey(video);
  if (recordKey) return `${source}:source-record:${firstText(video?.source_record_id)}`;
  const title = firstText(video?.campaign_title, video?.title);
  return title ? `${source}:title:${token(title)}` : null;
}

function recordCandidateSignature(record) {
  return JSON.stringify([
    record.candidate.industry_id,
    record.candidate.product_category_id,
    record.proposed.industry,
    record.proposed.product_category,
  ]);
}

function addManualReason(record, reason) {
  if (!record.conflicts.includes(reason)) record.conflicts.push(reason);
  if (!record.manual_review.reasons.includes(reason)) record.manual_review.reasons.push(reason);
  record.manual_review.required = true;
  record.manual_review_required = true;
  record.classification_review_status = "manual_review";
  record.confidence = "low";
}

function consistencyDiagnostics(records, keyName, conflictCode) {
  const groups = new Map();
  records.forEach((record, index) => {
    const key = record[keyName];
    if (!key) return;
    const indexes = groups.get(key) || [];
    indexes.push(index);
    groups.set(key, indexes);
  });
  const diagnostics = [];
  for (const [groupKey, indexes] of groups) {
    const signatures = new Map();
    for (const index of indexes) {
      const record = records[index];
      const signature = recordCandidateSignature(record);
      const group = signatures.get(signature) || [];
      group.push(record.video_id);
      signatures.set(signature, group);
    }
    const conflict = signatures.size > 1;
    const diagnostic = {
      key: groupKey,
      status: conflict ? "conflict" : "consistent",
      record_count: indexes.length,
      candidate_variants: [...signatures.entries()].map(([signature, ids]) => ({
        signature: JSON.parse(signature),
        record_count: ids.length,
        video_ids: ids,
      })),
    };
    diagnostics.push(diagnostic);
    for (const index of indexes) {
      const record = records[index];
      record.consistency[keyName === "campaign_key" ? "campaign" : "canonical_master"] = {
        status: diagnostic.status,
        group_key: groupKey,
        variant_count: signatures.size,
      };
      if (conflict) addManualReason(record, conflictCode);
    }
  }
  return diagnostics;
}

function buildRecordCandidate(video, index, taxonomy, registry, industryRules, categoryRules) {
  const id = videoId(video, index);
  const old = {
    industry: video?.industry ?? null,
    product_category: video?.product_category ?? null,
  };
  const inputs = currentClassificationInputs(video);
  const category = resolveDimension(inputs.product_category, "category", registry, categoryRules);
  const industry = resolveDimension(
    inputs.industry,
    "industry",
    registry,
    industryRules,
    uniqueStrings([inputs.product_category, category.proposed, ...category.matches.map((entry) => entry.name_en)]),
  );
  const conflicts = [];
  const diagnostics = [];
  const evidence = [
    `Current classification: ${inputs.industry || "<empty>"} / ${inputs.product_category || "<empty>"}.`,
  ];
  for (const rule of [...industry.rules, ...category.rules]) {
    evidence.push(rule.evidence || `Taxonomy migration rule: ${rule.from} -> ${rule.to}.`);
    if (MANUAL_STATUS_PATTERN.test(rule.status || "")) conflicts.push("migration_rule_requires_review");
  }
  if (industry.ambiguous_rule) conflicts.push("ambiguous_industry_migration_rule");
  if (category.ambiguous_rule) conflicts.push("ambiguous_category_migration_rule");

  let proposedIndustryEntry = industry.matches.length === 1 ? industry.matches[0] : null;
  let proposedCategoryEntry = category.matches.length === 1 ? category.matches[0] : null;
  if (!inputs.industry) conflicts.push("industry_missing");
  else if (isReserved(inputs.industry, taxonomy)) conflicts.push("industry_reserved_or_generic");
  if (!inputs.product_category) conflicts.push("product_category_missing");
  if (!text(old.product_category)) {
    conflicts.push("legacy_product_category_missing");
    const missingPolicy = taxonomy?.legacy_category_mappings?.missing_value_policy;
    if (missingPolicy && typeof missingPolicy === "object") {
      diagnostics.push({
        code: "legacy_product_category_missing",
        status: firstText(missingPolicy.status) || "evidence_insufficient",
        formal_product_category_id: missingPolicy.formal_product_category_id ?? null,
        automatic_registry_expansion_allowed: missingPolicy.automatic_registry_expansion_allowed === true,
        reason: firstText(missingPolicy.reason) || null,
      });
      if (missingPolicy.reason) evidence.push(`Missing-value policy: ${text(missingPolicy.reason)}`);
    }
  }
  else if (isReserved(inputs.product_category, taxonomy)) conflicts.push("product_category_reserved_or_generic");
  if (industry.matches.length === 0) conflicts.push("industry_not_in_closed_registry");
  if (industry.matches.length > 1) conflicts.push("industry_registry_collision");
  if (category.matches.length === 0) conflicts.push("product_category_not_in_closed_registry");
  if (category.matches.length > 1) conflicts.push("product_category_registry_collision");
  if (!category.matches.length && registry.industry_index.has(token(inputs.product_category))) {
    conflicts.push("product_category_uses_industry_value");
  }

  const categoryParentIds = new Set(category.matches.flatMap((entry) => [...entry.parent_industry_ids]));
  const invalidParentReferences = new Set(category.matches.flatMap((entry) => [...entry.invalid_parent_references]));
  if (proposedCategoryEntry?.conflict_status && MANUAL_STATUS_PATTERN.test(proposedCategoryEntry.conflict_status)) {
    conflicts.push("product_category_registry_conflict");
  }
  if (proposedIndustryEntry?.conflict_status && MANUAL_STATUS_PATTERN.test(proposedIndustryEntry.conflict_status)) {
    conflicts.push("industry_registry_conflict");
  }
  if (category.matches.length) {
    if (categoryParentIds.size === 0) conflicts.push("product_category_parent_missing");
    if (categoryParentIds.size > 1) conflicts.push("product_category_multiple_parents");
    if (invalidParentReferences.size) conflicts.push("product_category_parent_not_in_registry");
  }

  if (!proposedIndustryEntry && categoryParentIds.size === 1) {
    const parentId = [...categoryParentIds][0];
    proposedIndustryEntry = registry.industries.find((entry) => entry.id === parentId) || null;
    if (proposedIndustryEntry) {
      conflicts.push("industry_inferred_from_product_category");
      evidence.push(`Proposed industry inferred from the category's unique parent: ${proposedIndustryEntry.name_en}.`);
    }
  }

  const relationValid = Boolean(
    proposedIndustryEntry
      && proposedCategoryEntry
      && categoryParentIds.size === 1
      && categoryParentIds.has(proposedIndustryEntry.id)
      && invalidParentReferences.size === 0,
  );
  if (proposedIndustryEntry && proposedCategoryEntry && categoryParentIds.size === 1
    && !categoryParentIds.has(proposedIndustryEntry.id)) {
    conflicts.push("industry_product_category_parent_mismatch");
  }
  if (relationValid) {
    evidence.push(`Closed-registry parent verified: ${proposedCategoryEntry.name_en} -> ${proposedIndustryEntry.name_en}.`);
  }

  conflicts.push(...declaredTaxonomyConflict(taxonomy, [
    inputs.industry,
    inputs.product_category,
    industry.proposed,
    category.proposed,
  ]));
  conflicts.push(...existingManualSignals(video));

  const existingEvidence = uniqueStrings(array(video?.classification_candidate?.evidence)).slice(0, 6);
  for (const item of existingEvidence) evidence.push(`Existing candidate evidence: ${item}`);

  const uniqueConflicts = uniqueStrings(conflicts);
  const manualReviewRequired = uniqueConflicts.length > 0;
  const validIndustryEntry = proposedIndustryEntry && industry.matches.length <= 1 ? proposedIndustryEntry : null;
  const validCategoryEntry = relationValid && category.matches.length === 1 ? proposedCategoryEntry : null;
  const candidate = {
    ...candidateValue(validIndustryEntry, "industry"),
    ...candidateValue(validCategoryEntry, "category"),
  };
  const alternatives = {
    industries: ruleAlternatives(industry, "industry", registry),
    product_categories: ruleAlternatives(category, "category", registry),
  };
  const changed = token(old.industry) !== token(candidate.industry)
    || token(old.product_category) !== token(candidate.product_category);
  const ruleConfidence = [...industry.rules, ...category.rules]
    .map((rule) => normalizeConfidence(rule.confidence, "medium"));
  const confidence = manualReviewRequired
    ? "low"
    : ruleConfidence.includes("low")
      ? "low"
      : changed || ruleConfidence.length
        ? "medium"
        : "high";

  return {
    video_id: id,
    source_site: sourceId(video),
    source_record_id: firstText(video?.source_record_id) || null,
    source_record_key: sourceRecordKey(video),
    source_detail_url: firstText(video?.source_detail_url) || null,
    campaign_key: campaignKey(video),
    canonical_master_id: firstText(video?.canonical_master_id) || null,
    old,
    input_candidate: {
      industry: inputs.industry || null,
      product_category: inputs.product_category || null,
    },
    proposed: {
      industry_id: proposedIndustryEntry?.id || null,
      industry: proposedIndustryEntry?.name_en || industry.proposed || null,
      product_category_id: proposedCategoryEntry?.id || null,
      product_category: proposedCategoryEntry?.name_en || category.proposed || null,
    },
    candidate,
    alternatives,
    change_type: changed ? "mapped" : "unchanged",
    classification_review_status: manualReviewRequired ? "manual_review" : "candidate",
    confidence,
    evidence: uniqueStrings(evidence),
    diagnostics,
    conflicts: uniqueConflicts,
    manual_review: {
      required: manualReviewRequired,
      reasons: [...uniqueConflicts],
      candidate_industry_ids: alternatives.industries.map((entry) => entry.id).filter(Boolean),
      candidate_product_category_ids: alternatives.product_categories.map((entry) => entry.id).filter(Boolean),
    },
    manual_review_required: manualReviewRequired,
    consistency: {
      campaign: { status: "not_grouped", group_key: null, variant_count: 0 },
      canonical_master: { status: "not_grouped", group_key: null, variant_count: 0 },
    },
    review_state_snapshot: {
      review_status: video?.review_status ?? null,
      approved: video?.approved === true,
      core_template_eligible: video?.core_template_eligible === true,
      note: video?.note ?? null,
    },
    sidecar_only: true,
  };
}

/**
 * Build a read-only classification candidate sidecar for the three formal
 * source channels. No state, approval, or human-review field is mutated.
 */
export function buildClassificationGovernance(input = [], taxonomy = {}, options = {}) {
  const videos = Array.isArray(input) ? input : array(input?.videos);
  const sourceSites = uniqueStrings(options.sourceSites?.length ? options.sourceSites : DEFAULT_FORMAL_SOURCE_IDS)
    .map((value) => value.toLowerCase());
  const sourceSet = new Set(sourceSites);
  const registry = parseTaxonomyRegistry(taxonomy);
  const industryRules = migrationRules(taxonomy, "industry");
  const categoryRules = migrationRules(taxonomy, "category");
  const formalVideos = videos.filter((video) => sourceSet.has(sourceId(video)));
  const records = formalVideos.map((video, index) => (
    buildRecordCandidate(video, index, taxonomy, registry, industryRules, categoryRules)
  ));

  const campaignDiagnostics = consistencyDiagnostics(records, "campaign_key", "campaign_classification_inconsistent");
  const masterDiagnostics = consistencyDiagnostics(
    records,
    "canonical_master_id",
    "canonical_master_classification_inconsistent",
  );
  const bySource = Object.fromEntries(sourceSites.map((source) => [source, {
    records: 0,
    candidates: 0,
    manual_review: 0,
    conflicts: 0,
  }]));
  for (const record of records) {
    if (!bySource[record.source_site]) bySource[record.source_site] = { records: 0, candidates: 0, manual_review: 0, conflicts: 0 };
    bySource[record.source_site].records += 1;
    if (record.classification_review_status === "candidate") bySource[record.source_site].candidates += 1;
    if (record.manual_review_required) bySource[record.source_site].manual_review += 1;
    if (record.conflicts.length) bySource[record.source_site].conflicts += 1;
  }

  const changed = records.filter((record) => record.change_type === "mapped").length;
  const manual = records.filter((record) => record.manual_review_required).length;
  const conflictRecords = records.filter((record) => record.conflicts.length).length;
  const generatedAt = options.generated_at || options.generatedAt || new Date().toISOString();
  const stateSha256 = firstText(options.state_sha256, options.stateSha256) || null;
  const taxonomySha256 = firstText(options.taxonomy_sha256, options.taxonomySha256) || null;
  return {
    version: "classification-governance-v1",
    status: "candidate_sidecar",
    generated_at: generatedAt,
    input_state_sha256: stateSha256,
    scope: {
      id: "formal_three_sources",
      source_sites: sourceSites,
      excluded_source_record_count: videos.length - formalVideos.length,
      include_legacy_youtube: false,
    },
    provenance: {
      state_path: options.state_path || options.statePath || null,
      state_sha256: stateSha256,
      taxonomy_path: options.taxonomy_path || options.taxonomyPath || null,
      taxonomy_sha256: taxonomySha256,
      taxonomy_version: taxonomyVersion(taxonomy),
      mutation_policy: "read_only_sidecar",
      approval_policy: "Candidates never change human review or approval fields.",
    },
    taxonomy_registry: {
      mode: registry.mode,
      version: registry.version,
      industry_count: registry.industries.length,
      product_category_count: registry.categories.length,
      invalid_product_category_count: registry.invalid_categories.length,
    },
    summary: {
      input_record_count: videos.length,
      formal_record_count: formalVideos.length,
      filtered_record_count: videos.length - formalVideos.length,
      candidate_record_count: records.length - manual,
      manual_review_count: manual,
      confirmed_record_count: 0,
      changed_candidate_count: changed,
      unchanged_candidate_count: records.length - changed,
      conflict_record_count: conflictRecords,
      unresolved_industry_count: records.filter((record) => !record.candidate.industry_id).length,
      unresolved_product_category_count: records.filter((record) => !record.candidate.product_category_id).length,
      missing_value_policy_diagnostic_count: records.filter((record) => (
        record.diagnostics.some((diagnostic) => diagnostic.code === "legacy_product_category_missing")
      )).length,
      manual_product_category_alternative_count: records.filter((record) => (
        record.manual_review.candidate_product_category_ids.length > 1
      )).length,
      campaign_group_count: campaignDiagnostics.length,
      campaign_conflict_group_count: campaignDiagnostics.filter((group) => group.status === "conflict").length,
      canonical_master_group_count: masterDiagnostics.length,
      canonical_master_conflict_group_count: masterDiagnostics.filter((group) => group.status === "conflict").length,
      protected_review_field_changes: 0,
      by_source: bySource,
    },
    consistency: {
      campaigns: campaignDiagnostics,
      canonical_masters: masterDiagnostics,
    },
    records,
  };
}

export const buildTaxonomyV3MigrationSidecar = buildClassificationGovernance;

/**
 * Overlay candidates for a product preview without replacing confirmed fields.
 */
export function overlayRecordsForPreview(input = [], governance = {}) {
  const videos = Array.isArray(input) ? input : array(input?.videos);
  const byId = new Map(array(governance?.records).map((record) => [record.video_id, record]));
  return videos.map((video, index) => {
    const candidate = byId.get(videoId(video, index));
    if (!candidate) return { ...video };
    return {
      ...video,
      industry_candidate_v3: candidate.candidate.industry,
      product_category_candidate_v3: candidate.candidate.product_category,
      classification_governance: {
        version: governance.version || null,
        status: candidate.classification_review_status,
        confidence: candidate.confidence,
        candidate: { ...candidate.candidate },
        conflicts: [...candidate.conflicts],
        manual_review_required: candidate.manual_review_required,
        sidecar_only: true,
      },
      review_status: video.review_status,
      approved: video.approved,
      core_template_eligible: video.core_template_eligible,
      note: video.note,
    };
  });
}

export const FORMAL_CLASSIFICATION_SOURCE_IDS = DEFAULT_FORMAL_SOURCE_IDS;
