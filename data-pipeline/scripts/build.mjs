import path from "node:path";

import {
  channels,
  fileSha256,
  normalizedLookupKey,
  pipelineRoot,
  readJson,
  writeJsonAtomic,
} from "./lib.mjs";

const rulesDirectory = path.join(pipelineRoot, "rules");
const resultDirectory = path.join(pipelineRoot, "result");
const cleaningDirectory = path.join(rulesDirectory, "cleaning");
const cleaningRulePaths = {
  brand: path.join(cleaningDirectory, "brand.json"),
  crawl_time: path.join(cleaningDirectory, "crawl-time.json"),
  deduplication: path.join(cleaningDirectory, "deduplication.json"),
  duration: path.join(cleaningDirectory, "duration.json"),
  genre: path.join(cleaningDirectory, "genre.json"),
  industry: path.join(cleaningDirectory, "industry.json"),
  output: path.join(cleaningDirectory, "output.json"),
  product_category: path.join(cleaningDirectory, "product-category.json"),
  stable_record_id: path.join(cleaningDirectory, "stable-record-id.json"),
};
const industryMapPath = path.join(rulesDirectory, "mapping", "industry-map.json");
const categoryMapPath = path.join(rulesDirectory, "mapping", "product-category-map.json");
const genresPath = path.join(rulesDirectory, "taxonomy", "ad-video-genres.json");
const brandMapPath = path.join(rulesDirectory, "mapping", "brand-normalization-map.json");
const brandLogoCatalogPath = path.join(pipelineRoot, "resources", "brand-logo-catalog.json");
const resourceManifestPath = path.join(pipelineRoot, "resources", "manifest.json");

const [
  cleaningRules,
  industryMap,
  categoryMap,
  genreRegistry,
  brandMap,
  brandLogoCatalog,
  resourceManifest,
] = await Promise.all([
  Promise.all(Object.values(cleaningRulePaths).map(readJson)),
  readJson(industryMapPath),
  readJson(categoryMapPath),
  readJson(genresPath),
  readJson(brandMapPath),
  readJson(brandLogoCatalogPath),
  readJson(resourceManifestPath),
]);
const policy = Object.fromEntries(cleaningRules.map((rule) => [rule.id, rule]));

const ruleHashes = {
  cleaning: Object.fromEntries(await Promise.all(
    Object.entries(cleaningRulePaths).map(async ([name, filePath]) => [name, await fileSha256(filePath)]),
  )),
  industry_map: await fileSha256(industryMapPath),
  product_category_map: await fileSha256(categoryMapPath),
  genre_registry: await fileSha256(genresPath),
  brand_map: await fileSha256(brandMapPath),
};

const industryById = new Map(industryMap.industries.map((industry) => [industry.id, industry]));
const industryIdByName = new Map(
  industryMap.industries.map((industry) => [normalizedLookupKey(industry.industry), industry.id]),
);
const industryAliasToId = new Map(
  Object.entries(industryMap.aliases).map(([alias, id]) => [normalizedLookupKey(alias), id]),
);
const categoryById = new Map(categoryMap.categories.map((category) => [category.id, category]));
const categoryIdByName = new Map(
  categoryMap.categories.map((category) => [normalizedLookupKey(category.category), category.id]),
);
const categoryAliasToId = new Map(
  Object.entries(categoryMap.aliases).map(([alias, id]) => [normalizedLookupKey(alias), id]),
);
const validGenres = new Set(genreRegistry.genres.map((genre) => genre.english));
const localResourcePaths = new Set([
  ...(resourceManifest.logo_files || []),
  ...(resourceManifest.contact_sheets || []),
]);
const brandLogoById = new Map(
  brandLogoCatalog.brands
    .filter((brand) => brand.normalized_file_exists && brand.normalized?.file)
    .map((brand) => [brand.canonical_brand_id, `resources/brand-assets/${brand.normalized.file}`])
    .filter(([, resourcePath]) => localResourcePaths.has(resourcePath)),
);

function localContactSheet(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/^\/media\//, "").replace(/^\.\//, "");
  const resourcePath = normalized.startsWith("resources/contact-sheets/")
    ? normalized
    : normalized.startsWith("collect/")
      ? `resources/contact-sheets/${normalized}`
      : normalized;
  return localResourcePaths.has(resourcePath) ? resourcePath : null;
}

function createBrandLookup(mappingRule) {
  const displayNameById = new Map(
    (mappingRule.canonical_brands || [])
      .filter((brand) => brand.canonical_brand_id && brand.display_name)
      .map((brand) => [brand.canonical_brand_id, brand.display_name]),
  );
  const lookup = new Map();
  for (const mapping of mappingRule.raw_brand_mappings || []) {
    if (!mapping.canonical_brand_id || !displayNameById.has(mapping.canonical_brand_id)) continue;
    const key = normalizedLookupKey(mapping.raw_brand);
    if (!key) continue;
    lookup.set(key, {
      id: mapping.canonical_brand_id,
      name: displayNameById.get(mapping.canonical_brand_id),
    });
  }
  return lookup;
}

const brandByAlias = createBrandLookup(brandMap);

function recordId(record, channel) {
  return record.video_id || record.id || (
    record.source_record_id ? `${channel}:${record.source_record_id}` : null
  );
}

function categoryCandidates(record) {
  const values = [record.product_category, record.product_category_candidate];
  for (const candidate of record.product_category_candidates || []) {
    values.push(typeof candidate === "string" ? candidate : candidate?.category || candidate?.name);
  }
  return values.filter(Boolean);
}

function resolveCategory(record) {
  for (const value of categoryCandidates(record)) {
    const key = normalizedLookupKey(value);
    const categoryId = categoryIdByName.get(key) || categoryAliasToId.get(key);
    if (categoryId && categoryById.has(categoryId)) return categoryById.get(categoryId);
  }
  return null;
}

function resolveIndustry(record, category) {
  const candidates = [
    record.industry,
    record.industry_candidate,
    record.classification_candidate?.industry,
  ];
  for (const value of candidates) {
    const key = normalizedLookupKey(value);
    const industryId = industryIdByName.get(key) || industryAliasToId.get(key);
    if (industryId && industryById.has(industryId)) return industryById.get(industryId);
  }
  return category?.industry_id ? industryById.get(category.industry_id) || null : null;
}

function brandCandidates(record) {
  const values = [record.primary_brand, record.brand];
  for (const brand of record.brands || []) {
    values.push(typeof brand === "string" ? brand : brand?.name || brand?.brand);
  }
  return values.filter(Boolean);
}

function resolveBrands(record) {
  const resolved = [];
  const seen = new Set();
  for (const value of brandCandidates(record)) {
    const brand = brandByAlias.get(normalizedLookupKey(value));
    if (!brand || seen.has(brand.id)) continue;
    seen.add(brand.id);
    resolved.push(brand);
  }
  return resolved;
}

const reviewOnlyFields = new Set([
  "ai_generation_value",
  "ai_template_fit",
  "ai_visual_pre_review",
  "approved",
  "blacklisted",
  "canonical_match",
  "classification_candidate",
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
  "genre_candidates",
  "imported_from",
  "integration_taxonomy_candidate",
  "note",
  "reason_codes",
  "recall_genres",
  "record_state",
  "review_events",
  "review_status",
  "source_contact_sheet",
  "status_ids",
  "quality_score",
  "quality_score_breakdown",
  "publisher_role",
  "recency_status",
  "source_verification_status",
  "visual_review",
  "visual_notes",
  "visual_review_status",
  "industry_candidate",
  "product_category_candidate",
  "product_category_candidates",
]);

function cleanRecord(record, channel) {
  const id = recordId(record, channel);
  if (!id) return { reason: "missing_stable_record_id" };

  const duration = Number.isFinite(record.duration_seconds) ? record.duration_seconds : null;
  if (duration !== null && duration > policy.duration.maximum_seconds) {
    return { reason: "duration_over_limit" };
  }

  const category = resolveCategory(record);
  const industry = resolveIndustry(record, category);
  if (!industry) return { reason: "industry_unmapped" };

  const brands = resolveBrands(record);
  if (brands.length === 0) return { reason: "brand_unmapped" };

  const cleaned = Object.fromEntries(
    Object.entries(record).filter(([key]) => !reviewOnlyFields.has(key) && key !== "raw_source"),
  );
  cleaned.id = id;
  cleaned.video_id = record.video_id || id;
  cleaned.source_channel = channel;
  cleaned.source_site = record.source_site || channel;
  cleaned.industry_id = industry.id;
  cleaned.industry = industry.industry;
  cleaned.industry_zh = industry.zh;
  cleaned.product_category_id = category?.id || null;
  cleaned.product_category = category?.category || null;
  cleaned.product_category_zh = category?.zh || null;
  cleaned.brand_key = brands[0].id;
  cleaned.brand = brands[0].name;
  cleaned.primary_brand = brands[0].name;
  cleaned.brands = brands.map((brand) => ({ brand_key: brand.id, name: brand.name }));
  cleaned.brand_logo = brandLogoById.get(brands[0].id) || null;
  cleaned.contact_sheet = localContactSheet(record.contact_sheet);
  cleaned.genres = (record.genres || []).filter((genre) => validGenres.has(genre));
  cleaned.primary_genre = validGenres.has(record.primary_genre)
    ? record.primary_genre
    : cleaned.genres[0] || null;
  cleaned.secondary_genres = cleaned.genres.filter((genre) => genre !== cleaned.primary_genre);
  cleaned.data_quality = {
    crawl_time_missing: !record.crawl_collected_at,
    contact_sheet_missing: Boolean(record.contact_sheet) && !cleaned.contact_sheet,
    duration_missing: duration === null,
    product_category_unmapped: category === null,
  };
  cleaned.normalization = {
    original_industry: record.industry || record.industry_candidate || null,
    original_product_category: record.product_category || record.product_category_candidate || null,
    original_brand: record.primary_brand || record.brand || null,
  };
  return { record: cleaned };
}

const channelResults = {};
const aggregateRecords = [];
const aggregateIds = new Set();

for (const channel of channels) {
  const sourcePath = path.join(pipelineRoot, "source", channel, "records.json");
  const source = await readJson(sourcePath);
  const accepted = [];
  const seenIds = new Set();
  const filtered = {};
  let missingDuration = 0;

  for (const sourceRecord of source.records) {
    const outcome = cleanRecord(sourceRecord, channel);
    if (outcome.reason) {
      filtered[outcome.reason] = (filtered[outcome.reason] || 0) + 1;
      continue;
    }
    if (seenIds.has(outcome.record.id)) {
      filtered.duplicate_record_id = (filtered.duplicate_record_id || 0) + 1;
      continue;
    }
    seenIds.add(outcome.record.id);
    if (outcome.record.data_quality.duration_missing) missingDuration += 1;
    accepted.push(outcome.record);
  }

  accepted.sort((left, right) => left.id.localeCompare(right.id));
  const result = {
    channel,
    generated_at: new Date().toISOString(),
    source_sha256: await fileSha256(sourcePath),
    rule_sha256: ruleHashes,
    stats: {
      input: source.records.length,
      accepted: accepted.length,
      filtered: source.records.length - accepted.length,
      filtered_by_reason: filtered,
      accepted_with_missing_crawl_time: accepted.filter((record) => record.data_quality.crawl_time_missing).length,
      accepted_with_missing_duration: missingDuration,
    },
    records: accepted,
  };
  await writeJsonAtomic(path.join(resultDirectory, channel, "records.json"), result);
  channelResults[channel] = result.stats;

  for (const record of accepted) {
    if (aggregateIds.has(record.id)) continue;
    aggregateIds.add(record.id);
    aggregateRecords.push(record);
  }
}

aggregateRecords.sort((left, right) => left.id.localeCompare(right.id));
const aggregate = {
  generated_at: new Date().toISOString(),
  rule_sha256: ruleHashes,
  stats: {
    input: Object.values(channelResults).reduce((sum, stats) => sum + stats.input, 0),
    accepted: aggregateRecords.length,
    filtered: Object.values(channelResults).reduce((sum, stats) => sum + stats.filtered, 0),
    channels: Object.fromEntries(
      Object.entries(channelResults).map(([channel, stats]) => [channel, stats.accepted]),
    ),
  },
  records: aggregateRecords,
};

await writeJsonAtomic(path.join(resultDirectory, "creative-library.json"), aggregate);
await writeJsonAtomic(path.join(resultDirectory, "report.json"), {
  generated_at: aggregate.generated_at,
  policy: policy,
  source: aggregate.stats.input,
  result: aggregate.stats.accepted,
  channels: channelResults,
});

console.log(JSON.stringify(aggregate.stats, null, 2));
