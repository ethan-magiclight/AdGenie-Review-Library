#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);

function parseArgs(argv) {
  const options = {
    input: path.join(scriptDir, "brand-normalization-input-v1.json"),
    rules: path.join(scriptDir, "brand-normalization-rules-v1.json"),
    output: path.join(scriptDir, "brand-normalization-map-v1.json"),
    report: path.join(scriptDir, "brand-normalization-report-v1.md"),
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--input") options.input = path.resolve(argv[++index]);
    else if (argument === "--rules") options.rules = path.resolve(argv[++index]);
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--report") options.report = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeLookup(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[\u00ae\u2122]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "unknown-brand";
}

function collectBrandObjects(value, results = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectBrandObjects(item, results);
    return results;
  }

  if (!value || typeof value !== "object") return results;
  if (typeof value.brand === "string") results.push(value);
  for (const child of Object.values(value)) collectBrandObjects(child, results);
  return results;
}

function isCompoundRegistryName(value) {
  return /\s(?:\/|\bx\b|\u00d7)\s/i.test(String(value));
}

function loadRegistryAliases(rules) {
  const aliases = new Map();
  const conflicts = new Map();

  function addAlias(alias, canonicalName, source, status = "verified") {
    const lookup = normalizeLookup(alias);
    if (!lookup || isCompoundRegistryName(canonicalName)) return;
    const candidate = {
      canonical_brand_id: slugify(canonicalName),
      canonical_brand_name: canonicalName,
      entity_type: "brand",
      mapping_status: status,
      mapping_method: source,
    };
    const current = aliases.get(lookup);
    if (current && current.canonical_brand_id !== candidate.canonical_brand_id) {
      const values = conflicts.get(lookup) ?? new Set([current.canonical_brand_id]);
      values.add(candidate.canonical_brand_id);
      conflicts.set(lookup, values);
      aliases.delete(lookup);
      return;
    }
    if (!conflicts.has(lookup)) aliases.set(lookup, candidate);
  }

  for (const registryName of rules.registry_sources ?? []) {
    const registryPath = path.join(scriptDir, registryName);
    if (!fs.existsSync(registryPath)) throw new Error(`Missing registry: ${registryPath}`);
    const registry = readJson(registryPath);
    for (const item of collectBrandObjects(registry)) {
      addAlias(item.brand, item.brand, `registry:${registryName}`);
      for (const channel of item.official_channels ?? []) {
        if (/regional channels/i.test(channel)) continue;
        addAlias(channel, item.brand, `registry_official_channel:${registryName}`);
      }
    }
  }

  for (const override of rules.canonical_overrides ?? []) {
    for (const alias of override.aliases ?? []) {
      aliases.set(normalizeLookup(alias), {
        canonical_brand_id: override.canonical_brand_id,
        canonical_brand_name: override.display_name,
        entity_type: "brand",
        mapping_status: override.status,
        mapping_method: "manual_alias_override",
        evidence: override.evidence,
      });
      conflicts.delete(normalizeLookup(alias));
    }
  }

  return { aliases, conflicts };
}

function buildRawInventory(videos) {
  const inventory = new Map();

  for (const video of videos) {
    const rawBrand = String(video.brand ?? "").trim();
    const entry = inventory.get(rawBrand) ?? {
      raw_brand: rawBrand,
      video_count: 0,
      core_template_count: 0,
      source_sites: new Set(),
      industries: new Set(),
      sample_video_ids: [],
      sample_titles: [],
    };
    entry.video_count += 1;
    if (video.core_template_eligible === true) entry.core_template_count += 1;
    const source = video.source_site || video.source_platform;
    if (source) entry.source_sites.add(source);
    if (video.industry) entry.industries.add(video.industry);
    if (entry.sample_video_ids.length < 3) entry.sample_video_ids.push(video.video_id || video.id);
    if (entry.sample_titles.length < 3 && video.title) entry.sample_titles.push(video.title);
    inventory.set(rawBrand, entry);
  }

  return inventory;
}

function mapRawBrand(rawBrand, aliasData, mappingOverrides, entityOverrides, unmatchedBrandPolicy) {
  const mappingOverride = mappingOverrides.get(normalizeLookup(rawBrand));
  if (mappingOverride) {
    return {
      canonical_brand_id: mappingOverride.canonical_brand_id ?? null,
      canonical_brand_name: mappingOverride.display_name ?? null,
      entity_type: mappingOverride.entity_type ?? "brand",
      mapping_status: mappingOverride.status,
      mapping_method: "manual_raw_mapping_override",
      note: mappingOverride.note,
    };
  }

  const entityOverride = entityOverrides.get(normalizeLookup(rawBrand));
  if (entityOverride) {
    return {
      canonical_brand_id: null,
      canonical_brand_name: null,
      entity_type: entityOverride.entity_type,
      mapping_status: entityOverride.status,
      mapping_method: "manual_entity_override",
      note: entityOverride.note,
    };
  }

  const lookup = normalizeLookup(rawBrand);
  if (aliasData.conflicts.has(lookup)) {
    return {
      canonical_brand_id: slugify(rawBrand),
      canonical_brand_name: rawBrand,
      entity_type: "brand_candidate",
      mapping_status: "needs_review",
      mapping_method: "registry_conflict",
      note: `Conflicting registry identities: ${[...aliasData.conflicts.get(lookup)].sort().join(", ")}`,
    };
  }

  const mapped = aliasData.aliases.get(lookup);
  if (mapped) return { ...mapped };

  if (/\s(?:\/|\bx\b|\u00d7)\s/i.test(rawBrand)) {
    return {
      canonical_brand_id: null,
      canonical_brand_name: null,
      entity_type: "collaboration",
      mapping_status: "record_level_resolved",
      mapping_method: "compound_label_detection",
      note: "Compound source label is resolved through explicit per-video brand overrides",
    };
  }

  return {
    canonical_brand_id: slugify(rawBrand),
    canonical_brand_name: rawBrand,
    entity_type: unmatchedBrandPolicy.entity_type ?? "brand_candidate",
    mapping_status: unmatchedBrandPolicy.status ?? "needs_review",
    mapping_method: "source_brand_field_candidate",
    note: unmatchedBrandPolicy.note ?? "Identity preserved until an official brand or entity source is verified",
  };
}

function displayNameById(rawMappings, aliasData) {
  const names = new Map();
  for (const value of aliasData.aliases.values()) names.set(value.canonical_brand_id, value.canonical_brand_name);
  for (const value of rawMappings.values()) {
    if (value.canonical_brand_id && value.canonical_brand_name) {
      names.set(value.canonical_brand_id, value.canonical_brand_name);
    }
  }
  return names;
}

function buildVideoMapping(video, rawMapping, override, canonicalNames) {
  const videoId = video.video_id || video.id;
  let canonicalBrandIds = rawMapping.canonical_brand_id ? [rawMapping.canonical_brand_id] : [];
  let primaryBrandId = rawMapping.canonical_brand_id;
  let mappingStatus = rawMapping.mapping_status;
  let mappingMethod = rawMapping.mapping_method;
  let note = rawMapping.note ?? rawMapping.evidence ?? null;

  if (override) {
    canonicalBrandIds = override.canonical_brand_ids ?? canonicalBrandIds;
    primaryBrandId = Object.hasOwn(override, "primary_brand_id") ? override.primary_brand_id : primaryBrandId;
    mappingStatus = override.status ?? mappingStatus;
    mappingMethod = override.method ?? "record_override";
    note = override.note ?? note;
  }

  const overrideNames = override?.canonical_brand_names ?? [];
  const canonicalBrands = canonicalBrandIds.map((id, index) => ({
    id,
    name: canonicalNames.get(id) ?? overrideNames[index] ?? id,
  }));

  return {
    video_id: videoId,
    raw_brand: String(video.brand ?? "").trim(),
    raw_primary_brand: video.primary_brand || null,
    entity_type: rawMapping.entity_type,
    raw_brand_is_canonical_alias: canonicalBrandIds.some((id) => id === rawMapping.canonical_brand_id),
    canonical_brands: canonicalBrands,
    primary_brand_id: primaryBrandId,
    mapping_status: mappingStatus,
    mapping_method: mappingMethod,
    note,
  };
}

function aggregateCanonicalBrands(videoMappings) {
  const brands = new Map();
  for (const mapping of videoMappings) {
    for (const brand of mapping.canonical_brands) {
      const entry = brands.get(brand.id) ?? {
        canonical_brand_id: brand.id,
        display_name: brand.name,
        video_count: 0,
        primary_video_count: 0,
        raw_aliases: new Set(),
        source_labels: new Set(),
        mapping_statuses: new Set(),
      };
      entry.video_count += 1;
      if (mapping.primary_brand_id === brand.id) entry.primary_video_count += 1;
      if (mapping.raw_brand_is_canonical_alias) entry.raw_aliases.add(mapping.raw_brand);
      else entry.source_labels.add(mapping.raw_brand);
      entry.mapping_statuses.add(mapping.mapping_status);
      brands.set(brand.id, entry);
    }
  }

  return [...brands.values()]
    .map((entry) => ({
      ...entry,
      raw_aliases: [...entry.raw_aliases].sort((a, b) => a.localeCompare(b)),
      source_labels: [...entry.source_labels].sort((a, b) => a.localeCompare(b)),
      mapping_statuses: [...entry.mapping_statuses].sort(),
      logo_collection_readiness: entry.mapping_statuses.has("needs_review")
        ? "identity_review_required"
        : "identity_mapped_official_asset_required",
    }))
    .sort((left, right) => right.video_count - left.video_count || left.display_name.localeCompare(right.display_name));
}

function reportMarkdown(result) {
  const { summary, canonical_brands: brands, raw_brand_mappings: rawMappings } = result;
  const lines = [
    "# AdGenie 品牌归一化报告 v1",
    "",
    "> 本报告由 `collect/build-brand-normalization.mjs` 生成。原始 `brand` 不被覆盖；`proposed` 表示已建立可追溯候选映射但尚未获得官网身份或 Logo 证据，不能当作最终审核通过。",
    "",
    "## 汇总",
    "",
    "| 指标 | 数量 |",
    "|---|---:|",
    `| 视频记录 | ${summary.video_count} |`,
    `| 原始品牌值 | ${summary.raw_brand_value_count} |`,
    `| 标准品牌候选 | ${summary.canonical_brand_candidate_count} |`,
    `| 已映射视频 | ${summary.videos_with_canonical_brand} |`,
    `| 无单一品牌/非品牌视频 | ${summary.videos_without_canonical_brand} |`,
    `| 需要身份复核的原始值 | ${summary.raw_values_needing_review} |`,
    `| 未得到处理结论的原始值 | ${summary.raw_values_unresolved} |`,
    `| 已确认或已提出映射的原始值 | ${summary.raw_values_mapped} |`,
    "",
    "## 标准品牌候选",
    "",
    "| 品牌 | ID | 视频数 | 主品牌视频数 | 品牌别名 | 非品牌来源标签 | Logo 准备度 |",
    "|---|---|---:|---:|---|---|---|",
  ];

  for (const brand of brands) {
    lines.push(`| ${brand.display_name} | \`${brand.canonical_brand_id}\` | ${brand.video_count} | ${brand.primary_video_count} | ${brand.raw_aliases.join(" / ")} | ${brand.source_labels.join(" / ") || "-"} | ${brand.logo_collection_readiness} |`);
  }

  lines.push(
    "",
    "## 待身份复核的原始值",
    "",
    "| 原始值 | 视频数 | 实体类型 | 当前候选 | 样例 |",
    "|---|---:|---|---|---|",
  );

  for (const mapping of rawMappings.filter((item) => item.mapping_status === "needs_review")) {
    lines.push(`| ${mapping.raw_brand} | ${mapping.video_count} | ${mapping.entity_type} | ${mapping.canonical_brand_name ?? "-"} | ${(mapping.sample_titles[0] ?? "-").replaceAll("|", "\\|")} |`);
  }

  lines.push(
    "",
    "## 下一阶段：官方 Logo 采集",
    "",
    "只有 `logo_collection_readiness = identity_mapped_official_asset_required` 的品牌可直接进入官方资产检索。其余品牌先完成实体身份与别名复核，再采集 Logo，避免为创作者、代理商、地区频道或错误元数据建立伪品牌资产。",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function assertResult(result) {
  const { summary, raw_brand_mappings: rawMappings, video_mappings: videoMappings } = result;
  if (summary.video_count !== videoMappings.length) throw new Error("Every video must have exactly one mapping record");
  if (summary.raw_brand_value_count !== rawMappings.length) throw new Error("Every raw brand value must have exactly one mapping record");
  const videoIds = new Set(videoMappings.map((item) => item.video_id));
  if (videoIds.size !== videoMappings.length) throw new Error("Video mappings contain duplicate video_id values");
  const rawValues = new Set(rawMappings.map((item) => item.raw_brand));
  if (rawValues.size !== rawMappings.length) throw new Error("Raw brand mappings contain duplicate raw_brand values");
  for (const mapping of videoMappings) {
    if (mapping.primary_brand_id && !mapping.canonical_brands.some((brand) => brand.id === mapping.primary_brand_id)) {
      throw new Error(`Primary brand is missing from canonical brands for ${mapping.video_id}`);
    }
  }
}

function writeOrCheck(filePath, content, check) {
  if (check) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing generated file: ${filePath}`);
    if (fs.readFileSync(filePath, "utf8") !== content) throw new Error(`Generated file is stale: ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const state = readJson(options.input);
  const rules = readJson(options.rules);
  const videos = Object.values(state.videos ?? {});
  const inventory = buildRawInventory(videos);
  const aliasData = loadRegistryAliases(rules);
  const mappingOverrides = new Map((rules.raw_mapping_overrides ?? []).map((item) => [normalizeLookup(item.raw_brand), item]));
  const entityOverrides = new Map((rules.raw_entity_overrides ?? []).map((item) => [normalizeLookup(item.raw_brand), item]));
  const unmatchedBrandPolicy = rules.unmatched_brand_policy ?? {};
  const recordOverrides = new Map();
  for (const override of rules.record_overrides ?? []) {
    recordOverrides.set(override.video_id, { ...(recordOverrides.get(override.video_id) ?? {}), ...override });
  }

  const rawMappingByValue = new Map();
  const rawBrandMappings = [...inventory.values()]
    .map((inventoryEntry) => {
      const mapped = mapRawBrand(inventoryEntry.raw_brand, aliasData, mappingOverrides, entityOverrides, unmatchedBrandPolicy);
      rawMappingByValue.set(inventoryEntry.raw_brand, mapped);
      return {
        ...inventoryEntry,
        source_sites: [...inventoryEntry.source_sites].sort(),
        industries: [...inventoryEntry.industries].sort(),
        ...mapped,
      };
    })
    .sort((left, right) => right.video_count - left.video_count || left.raw_brand.localeCompare(right.raw_brand));

  const canonicalNames = displayNameById(rawMappingByValue, aliasData);
  const videoMappings = videos
    .map((video) => {
      const rawBrand = String(video.brand ?? "").trim();
      const videoId = video.video_id || video.id;
      return buildVideoMapping(video, rawMappingByValue.get(rawBrand), recordOverrides.get(videoId), canonicalNames);
    })
    .sort((left, right) => left.video_id.localeCompare(right.video_id));

  const canonicalBrands = aggregateCanonicalBrands(videoMappings);
  const result = {
    version: 1,
    generated_for_rules_updated_at: rules.updated_at,
    source: path.relative(repoRoot, options.input),
    rules: path.relative(repoRoot, options.rules),
    summary: {
      video_count: videos.length,
      raw_brand_value_count: rawBrandMappings.length,
      canonical_brand_candidate_count: canonicalBrands.length,
      videos_with_canonical_brand: videoMappings.filter((item) => item.canonical_brands.length > 0).length,
      videos_without_canonical_brand: videoMappings.filter((item) => item.canonical_brands.length === 0).length,
      raw_values_needing_review: rawBrandMappings.filter((item) => item.mapping_status === "needs_review").length,
      raw_values_unresolved: rawBrandMappings.filter((item) => item.mapping_status === "needs_review").length,
      raw_values_mapped: rawBrandMappings.filter((item) => item.mapping_status !== "needs_review").length,
    },
    canonical_brands: canonicalBrands,
    raw_brand_mappings: rawBrandMappings,
    video_mappings: videoMappings,
  };

  assertResult(result);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const markdown = reportMarkdown(result);
  writeOrCheck(options.output, json, options.check);
  writeOrCheck(options.report, markdown, options.check);
  console.log(JSON.stringify(result.summary, null, 2));
}

main();
