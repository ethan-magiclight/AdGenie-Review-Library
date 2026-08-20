import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.join(collectRoot, "source-video-record-contract-v1.json");
const taxonomyPath = path.join(collectRoot, "adgenie-brand-taxonomy-v1.json");
const mappingPath = path.join(collectRoot, "source-category-mapping-v1.json");
const targetYears = new Set([2025, 2026]);
const bestAdsCategories = new Set([
  "Clothing & footwear",
  "Confectionery & snacks",
  "Cosmetics & toiletries",
  "Drinks, non-alcoholic",
  "Food",
  "Home appliances & furnishings",
  "Home electronics",
  "Household, garden & pets",
  "Sportswear",
]);
const requiredRecordFields = [
  "schema_version", "source_site", "source_record_id", "source_detail_url", "source_categories",
  "source_industries", "source_medium_types", "primary_brand", "brands", "campaign_title", "description",
  "agency", "production_companies", "country", "campaign_published_at", "source_uploaded_at",
  "publish_date_source", "publish_date_confidence", "campaign_year_status", "collected_at", "record_state",
  "review_status", "approved", "core_template_eligible", "genres", "classification_candidate", "source_refs",
  "media_assets", "raw_source",
];
const requiredVideoFields = [
  "asset_id", "media_type", "provider", "source_asset_id", "original_url", "playback_url", "thumbnail_url",
  "duration_seconds", "width", "height", "aspect_ratio", "access_status", "checked_at", "expires_at",
  "locator_is_temporary", "contact_sheet_path", "contact_sheet_status", "failure_reason",
];
const pendingStates = new Set([
  "pending_brand", "pending_year_evidence", "campaign_date_unverified", "pending_video", "pending_category_review",
]);

function parseArgs(argv) {
  const result = { files: [], selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--file") {
      result.files.push(path.resolve(process.cwd(), argv[index + 1]));
      index += 1;
    } else if (item === "--self-test") {
      result.selfTest = true;
    } else if (item === "--help" || item === "-h") {
      console.log("Usage: node collect/validate-source-records.mjs [--file batch.json]... [--self-test]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return result;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.campaigns || payload.candidates || [];
}

function validateConfig(contract, taxonomy, mapping) {
  const errors = [];
  const contractRequired = new Set(contract.required || []);
  for (const field of requiredRecordFields) {
    if (!contractRequired.has(field)) errors.push(`CONTRACT_REQUIRED_FIELD_MISSING:${field}`);
  }

  const industryCategories = new Map();
  for (const industry of taxonomy.industries || []) {
    if (!industry.industry) errors.push("TAXONOMY_INDUSTRY_NAME_REQUIRED");
    if (industryCategories.has(industry.industry)) errors.push(`TAXONOMY_DUPLICATE_INDUSTRY:${industry.industry}`);
    const categories = new Set();
    for (const category of industry.categories || []) {
      if (!category.category) errors.push(`TAXONOMY_CATEGORY_NAME_REQUIRED:${industry.industry}`);
      if (categories.has(category.category)) errors.push(`TAXONOMY_DUPLICATE_CATEGORY:${industry.industry}:${category.category}`);
      if (/unclassified/i.test(category.category || "")) errors.push(`TAXONOMY_UNCLASSIFIED_FORBIDDEN:${industry.industry}`);
      categories.add(category.category);
    }
    industryCategories.set(industry.industry, categories);
  }
  for (const required of ["Apparel & Footwear", "Beauty & Personal Care", "Food & Beverage", "Home & Living/Household"]) {
    if (!industryCategories.has(required)) errors.push(`TAXONOMY_REQUIRED_INDUSTRY_MISSING:${required}`);
  }

  const mappingKeys = new Set();
  const mappedBestAdsCategories = new Set();
  for (const entry of mapping.mappings || []) {
    const key = `${entry.source_site}:${entry.match_field}:${entry.source_value}`;
    if (mappingKeys.has(key)) errors.push(`MAPPING_DUPLICATE:${key}`);
    mappingKeys.add(key);
    if (entry.source_site === "best_ads") mappedBestAdsCategories.add(entry.source_value);
    if (!["mapped_candidate", "pending_category_review"].includes(entry.status)) errors.push(`MAPPING_STATUS_INVALID:${key}`);
    if (!Array.isArray(entry.candidates) || !entry.candidates.length) errors.push(`MAPPING_CANDIDATES_REQUIRED:${key}`);
    for (const candidate of entry.candidates || []) {
      if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
        errors.push(`MAPPING_CONFIDENCE_INVALID:${key}`);
      }
      if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) errors.push(`MAPPING_EVIDENCE_REQUIRED:${key}`);
      if (/unclassified/i.test(candidate.product_category || "")) errors.push(`MAPPING_UNCLASSIFIED_FORBIDDEN:${key}`);
      if (industryCategories.has(candidate.industry) && candidate.product_category && !industryCategories.get(candidate.industry).has(candidate.product_category)) {
        errors.push(`MAPPING_UNKNOWN_CATEGORY:${key}:${candidate.industry}:${candidate.product_category}`);
      }
    }
  }
  for (const category of bestAdsCategories) {
    if (!mappedBestAdsCategories.has(category)) errors.push(`BEST_ADS_MAPPING_MISSING:${category}`);
  }
  const bundled = (mapping.mappings || []).find((entry) => entry.source_site === "best_ads" && entry.source_value === "Household, garden & pets");
  const bundledIndustries = new Set((bundled?.candidates || []).map((candidate) => candidate.industry));
  if (bundled?.status !== "pending_category_review" || !bundledIndustries.has("Home & Living/Household") || !bundledIndustries.has("Pet Supplies")) {
    errors.push("HOUSEHOLD_GARDEN_PETS_MUST_SPLIT_FOR_REVIEW");
  }
  return { ok: errors.length === 0, errors, industries: industryCategories.size, mappings: mappingKeys.size };
}

export function validateSourceRecord(record) {
  const errors = [];
  const pending = [];
  const addError = (code) => errors.push(code);
  const addPending = (code) => pending.push(code);

  if (!isObject(record)) return { ok: false, importable: false, errors: ["RECORD_OBJECT_REQUIRED"], pending: [] };
  for (const field of requiredRecordFields) {
    if (!hasOwn(record, field)) addError(`REQUIRED_FIELD_MISSING:${field}`);
  }
  if (record.schema_version !== "source-video-record-v1") addError("SCHEMA_VERSION_INVALID");
  if (!["best_ads", "ads_of_the_world"].includes(record.source_site)) addError("SOURCE_SITE_INVALID");
  if (!String(record.source_record_id || "").trim()) addError("SOURCE_RECORD_ID_REQUIRED");
  if (!isHttpUrl(record.source_detail_url)) addError("SOURCE_DETAIL_URL_REQUIRED");
  for (const key of ["source_categories", "source_industries", "source_medium_types", "brands", "production_companies", "source_refs", "media_assets", "genres"]) {
    if (!Array.isArray(record[key])) addError(`ARRAY_REQUIRED:${key}`);
  }
  if (!parseDate(record.collected_at)) addError("COLLECTED_AT_INVALID");
  if (record.review_status !== "pending_review") addError("NEW_RECORD_MUST_BE_PENDING_REVIEW");
  if (record.approved !== false) addError("AI_APPROVAL_FORBIDDEN");
  if (record.core_template_eligible !== false) addError("AI_CORE_TEMPLATE_ELIGIBILITY_FORBIDDEN");
  if (Array.isArray(record.genres) && record.genres.length) addError("FORMAL_GENRES_MUST_REMAIN_EMPTY");
  if (!isObject(record.raw_source) || !Object.keys(record.raw_source).length) addError("RAW_SOURCE_EVIDENCE_REQUIRED");

  const hasBrand = typeof record.primary_brand === "string" && record.primary_brand.trim() && Array.isArray(record.brands) && record.brands.includes(record.primary_brand);
  if (!hasBrand) {
    if (record.record_state === "pending_brand") addPending("PRIMARY_BRAND_PENDING");
    else addError("PRIMARY_BRAND_REQUIRED");
  }

  const classification = record.classification_candidate;
  if (!isObject(classification)) {
    addError("CLASSIFICATION_CANDIDATE_REQUIRED");
  } else {
    if (!["mapped_candidate", "pending_category_review"].includes(classification.status)) addError("CLASSIFICATION_STATUS_INVALID");
    if (!Number.isFinite(classification.confidence) || classification.confidence < 0 || classification.confidence > 1) addError("CLASSIFICATION_CONFIDENCE_INVALID");
    if (!Array.isArray(classification.evidence) || !classification.evidence.length) addError("CLASSIFICATION_EVIDENCE_REQUIRED");
    if (/unclassified/i.test(classification.product_category || "")) addError("UNCLASSIFIED_CATEGORY_FORBIDDEN");
    if (classification.status === "pending_category_review") addPending("CATEGORY_REVIEW_PENDING");
    else if (!classification.industry || !classification.product_category) addError("CLASSIFICATION_CANDIDATE_INCOMPLETE");
  }

  const currentSourceRef = (record.source_refs || []).find((ref) =>
    ref?.source_site === record.source_site
    && ref.source_record_id === record.source_record_id
    && ref.source_detail_url === record.source_detail_url
  );
  if (!currentSourceRef) addError("PRIMARY_SOURCE_REF_REQUIRED");

  const videoAssets = [];
  const assetIds = new Set();
  for (const asset of record.media_assets || []) {
    if (!isObject(asset)) {
      addError("MEDIA_ASSET_OBJECT_REQUIRED");
      continue;
    }
    for (const field of requiredVideoFields) {
      if (!hasOwn(asset, field)) addError(`MEDIA_FIELD_MISSING:${asset.asset_id || "unknown"}:${field}`);
    }
    if (!asset.asset_id) addError("MEDIA_ASSET_ID_REQUIRED");
    if (assetIds.has(asset.asset_id)) addError(`DUPLICATE_MEDIA_ASSET_ID:${asset.asset_id}`);
    assetIds.add(asset.asset_id);
    if (asset.media_type !== "video") continue;
    videoAssets.push(asset);
    if (!asset.source_asset_id) addError(`VIDEO_SOURCE_ASSET_ID_REQUIRED:${asset.asset_id}`);
    if (asset.provider === "unknown" || !asset.provider) addError(`VIDEO_PROVIDER_REQUIRED:${asset.asset_id}`);
    if (!isHttpUrl(asset.original_url) && !isHttpUrl(asset.playback_url)) addError(`VIDEO_LOCATOR_REQUIRED:${asset.asset_id}`);
    if (asset.locator_is_temporary && (!parseDate(asset.expires_at) || !asset.source_asset_id || !currentSourceRef)) {
      addError(`TEMPORARY_VIDEO_STABLE_LOCATOR_REQUIRED:${asset.asset_id}`);
    }
    if (["available", "temporary"].includes(asset.access_status)) {
      if (!parseDate(asset.checked_at)) addError(`VIDEO_CHECKED_AT_REQUIRED:${asset.asset_id}`);
      if (!(Number(asset.duration_seconds) > 0)) {
        if (record.record_state === "ready_for_media_review") addError(`VIDEO_DURATION_REQUIRED:${asset.asset_id}`);
        else addPending(`VIDEO_DURATION_PENDING:${asset.asset_id}`);
      }
      if (!(Number(asset.width) > 0) || !(Number(asset.height) > 0) || !asset.aspect_ratio) {
        if (record.record_state === "ready_for_media_review") addError(`VIDEO_DIMENSIONS_REQUIRED:${asset.asset_id}`);
        else addPending(`VIDEO_DIMENSIONS_PENDING:${asset.asset_id}`);
      }
    }
    if (["error", "expired", "forbidden", "not_found"].includes(asset.access_status) && !asset.failure_reason) {
      addError(`VIDEO_FAILURE_REASON_REQUIRED:${asset.asset_id}`);
    }
  }
  if (!videoAssets.length) {
    if (record.record_state === "pending_video") addPending("VIDEO_ASSET_PENDING");
    else addError("VIDEO_ASSET_REQUIRED");
  }

  const campaignDate = parseDate(record.campaign_published_at);
  const campaignYear = campaignDate?.getUTCFullYear() || null;
  if (record.campaign_published_at && !campaignDate) addError("CAMPAIGN_PUBLISHED_AT_INVALID");
  if (record.source_uploaded_at && !parseDate(record.source_uploaded_at)) addError("SOURCE_UPLOADED_AT_INVALID");

  if (record.source_site === "ads_of_the_world") {
    if (!(record.source_medium_types || []).some((medium) => String(medium).toLowerCase() === "film")) addError("AOTW_FILM_MEDIUM_REQUIRED");
    if (!campaignDate || !targetYears.has(campaignYear)) addError("AOTW_CAMPAIGN_DATE_2025_2026_REQUIRED");
    if (record.publish_date_source !== "campaign_published_date") addError("AOTW_DATE_SOURCE_MUST_BE_CAMPAIGN_PUBLISHED");
    if (record.campaign_year_status !== `confirmed_${campaignYear}`) addError("AOTW_CAMPAIGN_YEAR_STATUS_INVALID");
  }
  if (record.source_site === "best_ads") {
    if (String(record.country || "").toLowerCase() !== "united states") addError("BEST_ADS_COUNTRY_MUST_BE_UNITED_STATES");
    if (!(record.source_medium_types || []).some((medium) => String(medium).toLowerCase() === "tv")) addError("BEST_ADS_TV_MEDIUM_REQUIRED");
    const invalidCategories = (record.source_categories || []).filter((category) => !bestAdsCategories.has(category));
    if (invalidCategories.length) addError(`BEST_ADS_CATEGORY_OUT_OF_SCOPE:${invalidCategories.join("|")}`);
    const dateConfirmed = campaignDate && targetYears.has(campaignYear) && ["independent_campaign_evidence", "campaign_published_date"].includes(record.publish_date_source);
    if (dateConfirmed) {
      if (record.campaign_year_status !== `confirmed_${campaignYear}`) addError("BEST_ADS_CONFIRMED_YEAR_STATUS_INVALID");
    } else if (record.record_state === "campaign_date_unverified" && record.campaign_year_status === "campaign_date_unverified") {
      addPending("BEST_ADS_CAMPAIGN_DATE_UNVERIFIED");
      if (!record.source_uploaded_at) addError("BEST_ADS_SOURCE_UPLOADED_AT_REQUIRED_FOR_UNVERIFIED_DATE");
      if (record.publish_date_source !== "source_uploaded_only") addError("BEST_ADS_UNVERIFIED_DATE_SOURCE_INVALID");
    } else {
      addError("BEST_ADS_CAMPAIGN_YEAR_EVIDENCE_REQUIRED");
    }
  }

  if (pendingStates.has(record.record_state) && !pending.length && !errors.length) addError("PENDING_STATE_WITHOUT_PENDING_REASON");
  if (record.record_state === "ready_for_media_review" && pending.length) addError("READY_RECORD_HAS_PENDING_REQUIREMENTS");
  const result = {
    ok: errors.length === 0,
    importable: errors.length === 0 && pending.length === 0 && record.record_state === "ready_for_media_review",
    errors: unique(errors),
    pending: unique(pending),
  };
  return result;
}

export function validateSourceBatch(records) {
  const results = records.map((record, index) => ({ index, source_key: `${record?.source_site || "unknown"}:${record?.source_record_id || "missing"}`, ...validateSourceRecord(record) }));
  const sourceKeyCounts = new Map();
  for (const result of results) sourceKeyCounts.set(result.source_key, (sourceKeyCounts.get(result.source_key) || 0) + 1);
  const duplicateSourceKeys = [...sourceKeyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicateSourceKeys.length) {
    for (const result of results.filter((item) => duplicateSourceKeys.includes(item.source_key))) {
      result.ok = false;
      result.importable = false;
      result.errors = unique([...result.errors, `DUPLICATE_SOURCE_RECORD:${result.source_key}`]);
    }
  }
  return {
    ok: results.every((result) => result.ok),
    records: records.length,
    importable: results.filter((result) => result.importable).length,
    pending: results.filter((result) => result.ok && !result.importable).length,
    invalid: results.filter((result) => !result.ok).length,
    duplicate_source_records: duplicateSourceKeys.length,
    results,
  };
}

function validFixture() {
  const collectedAt = "2026-08-19T00:00:00.000Z";
  const detailUrl = "https://www.adsoftheworld.com/campaigns/example-campaign";
  return {
    schema_version: "source-video-record-v1",
    source_site: "ads_of_the_world",
    source_record_id: "example-campaign",
    source_detail_url: detailUrl,
    source_categories: [],
    source_industries: ["Food"],
    source_medium_types: ["Film"],
    primary_brand: "Example Brand",
    brands: ["Example Brand"],
    campaign_id: "aotw:example-campaign",
    campaign_title: "Example Campaign",
    description: "Validation fixture",
    agency: "Example Agency",
    production_companies: [],
    country: "United Kingdom",
    campaign_published_at: "2025-06-01",
    source_uploaded_at: null,
    publish_date_source: "campaign_published_date",
    publish_date_confidence: "confirmed",
    campaign_year_status: "confirmed_2025",
    collected_at: collectedAt,
    record_state: "ready_for_media_review",
    review_status: "pending_review",
    approved: false,
    core_template_eligible: false,
    genres: [],
    canonical_master_id: null,
    classification_candidate: {
      industry: "Food & Beverage",
      product_category: "Food Products",
      status: "mapped_candidate",
      confidence: 0.82,
      evidence: ["AOTW source industry Food"],
    },
    source_refs: [{
      source_site: "ads_of_the_world",
      source_record_id: "example-campaign",
      source_detail_url: detailUrl,
      source_asset_id: "video-1",
      relation: "primary",
      collected_at: collectedAt,
    }],
    media_assets: [{
      asset_id: "video-1",
      media_type: "video",
      provider: "mp4",
      source_asset_id: "video-1",
      original_url: "https://cdn.example.test/video-1.mp4",
      playback_url: "https://cdn.example.test/video-1.mp4",
      thumbnail_url: "https://cdn.example.test/video-1.jpg",
      duration_seconds: 30,
      width: 1920,
      height: 1080,
      aspect_ratio: "16:9",
      access_status: "available",
      checked_at: collectedAt,
      expires_at: null,
      locator_is_temporary: false,
      contact_sheet_path: null,
      contact_sheet_status: "pending",
      failure_reason: null,
    }],
    raw_source: { fixture: true },
  };
}

function runSelfTest() {
  const cases = [
    ["missing_brand", (record) => { record.primary_brand = null; record.brands = []; }, "PRIMARY_BRAND_REQUIRED"],
    ["fake_date", (record) => { record.campaign_published_at = "not-a-date"; }, "CAMPAIGN_PUBLISHED_AT_INVALID"],
    ["no_video", (record) => { record.media_assets = []; }, "VIDEO_ASSET_REQUIRED"],
  ];
  const redGreen = cases.map(([name, mutate, expectedCode]) => {
    const redRecord = structuredClone(validFixture());
    mutate(redRecord);
    const red = validateSourceBatch([redRecord]);
    const green = validateSourceBatch([validFixture()]);
    return {
      case: name,
      expected_error: expectedCode,
      red: { ok: red.ok, errors: red.results[0].errors },
      green: { ok: green.ok, importable: green.importable },
      passed: !red.ok && red.results[0].errors.some((error) => error.includes(expectedCode)) && green.ok && green.importable === 1,
    };
  });
  const duplicate = validateSourceBatch([validFixture(), validFixture()]);
  redGreen.push({
    case: "duplicate_record",
    expected_error: "DUPLICATE_SOURCE_RECORD",
    red: { ok: duplicate.ok, errors: duplicate.results.flatMap((result) => result.errors) },
    green: { ok: validateSourceBatch([validFixture()]).ok, importable: validateSourceBatch([validFixture()]).importable },
    passed: !duplicate.ok && duplicate.duplicate_source_records === 1 && validateSourceBatch([validFixture()]).ok,
  });
  const ambiguousRedRecord = validFixture();
  ambiguousRedRecord.classification_candidate.product_category = null;
  const ambiguousGreenRecord = structuredClone(ambiguousRedRecord);
  ambiguousGreenRecord.record_state = "pending_category_review";
  ambiguousGreenRecord.classification_candidate.status = "pending_category_review";
  ambiguousGreenRecord.classification_candidate.alternatives = [
    { industry: "Food & Beverage", product_category: "Food Products", confidence: 0.5, evidence: ["Visual product evidence required."] },
    { industry: "Food & Beverage", product_category: "Non-Alcoholic Beverages", confidence: 0.5, evidence: ["Visual product evidence required."] },
  ];
  const ambiguousRed = validateSourceBatch([ambiguousRedRecord]);
  const ambiguousGreen = validateSourceBatch([ambiguousGreenRecord]);
  redGreen.push({
    case: "unmarked_category_ambiguity",
    expected_error: "CLASSIFICATION_CANDIDATE_INCOMPLETE",
    red: { ok: ambiguousRed.ok, errors: ambiguousRed.results[0].errors },
    green: { ok: ambiguousGreen.ok, pending: ambiguousGreen.results[0].pending },
    passed: !ambiguousRed.ok
      && ambiguousRed.results[0].errors.includes("CLASSIFICATION_CANDIDATE_INCOMPLETE")
      && ambiguousGreen.ok
      && ambiguousGreen.results[0].pending.includes("CATEGORY_REVIEW_PENDING"),
  });
  return { ok: redGreen.every((item) => item.passed), red_to_green: redGreen };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [contract, taxonomy, mapping] = await Promise.all([
    fs.readFile(contractPath, "utf8").then(JSON.parse),
    fs.readFile(taxonomyPath, "utf8").then(JSON.parse),
    fs.readFile(mappingPath, "utf8").then(JSON.parse),
  ]);
  const config = validateConfig(contract, taxonomy, mapping);
  const files = [];
  for (const file of args.files) {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    files.push({ file: path.relative(collectRoot, file), ...validateSourceBatch(readRecords(payload)) });
  }
  const selfTest = args.selfTest ? runSelfTest() : null;
  const summary = { ok: config.ok && files.every((file) => file.ok) && (!selfTest || selfTest.ok), config, files, self_test: selfTest };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
