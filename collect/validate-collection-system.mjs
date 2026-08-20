import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const policies = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--policy") {
      policies.push(argv[index + 1]);
      index += 1;
    } else if (item === "--help" || item === "-h") {
      console.log("Usage: node collect/validate-collection-system.mjs [--policy file]...");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return { policies: policies.length ? policies : ["collection-policy-v1.json"] };
}

function resolveInputPath(file, baseDir = collectDir) {
  if (path.isAbsolute(file)) return file;
  if (file.startsWith("collect/")) return path.resolve(collectDir, "..", file);
  return path.resolve(baseDir, file);
}

async function readJson(file, baseDir = collectDir) {
  return JSON.parse(await fs.readFile(resolveInputPath(file, baseDir), "utf8"));
}

async function validatePolicy(policyFile) {
  const policyPath = resolveInputPath(policyFile);
  const policy = await readJson(policyPath);
  const policyDir = path.dirname(policyPath);
  const [taxonomy, genres, brands, sources] = await Promise.all([
    readJson(policy.taxonomy_file, policyDir),
    readJson(policy.genre_file, policyDir),
    readJson(policy.brand_file, policyDir),
    readJson(policy.source_file, policyDir),
  ]);

  const errors = [];
  const warnings = [];
  const categoryNames = taxonomy.categories.map((item) => item.category);
  const genreNames = genres.genres.map((item) => item.english);
  const sourceIds = new Set();
  const channelIds = new Set();
  const allBrands = new Set();

  if ((taxonomy.industry || policy.industry) && brands.industry && taxonomy.industry && brands.industry !== taxonomy.industry) {
    errors.push(`Taxonomy industry does not match brand registry: ${taxonomy.industry} vs ${brands.industry}`);
  }

  for (const category of categoryNames) {
  const entries = brands.categories[category];
  if (!Array.isArray(entries) || !entries.length) {
    errors.push(`Top brand registry is missing category: ${category}`);
    continue;
  }
  const names = new Set();
  for (const entry of entries) {
    if (!entry.brand) errors.push(`Brand without name in category: ${category}`);
    if (names.has(entry.brand)) errors.push(`Duplicate brand in ${category}: ${entry.brand}`);
    names.add(entry.brand);
    allBrands.add(entry.brand);
    if (!Array.isArray(entry.products) || !entry.products.length) {
      errors.push(`Brand products missing: ${category}/${entry.brand}`);
    }
    if (!["P0", "P1", "P2"].includes(entry.tier)) errors.push(`Invalid brand tier: ${category}/${entry.brand}`);
  }
  }

  for (const category of Object.keys(brands.categories)) {
  if (!categoryNames.includes(category)) errors.push(`Brand registry contains unknown category: ${category}`);
  }
  for (const source of sources.sources || []) {
  if (sourceIds.has(source.id)) errors.push(`Duplicate source id: ${source.id}`);
  sourceIds.add(source.id);
  if (source.channel_id) {
    if (channelIds.has(source.channel_id)) errors.push(`Duplicate source channel id: ${source.channel_id}`);
    channelIds.add(source.channel_id);
  }
  if (!allBrands.has(source.brand)) warnings.push(`Source brand is not in Top brand registry: ${source.brand}`);
  if (!source.verified_at) errors.push(`Source verification date missing: ${source.id}`);
  if (!Array.isArray(source.formats) || !source.formats.length) errors.push(`Source formats missing: ${source.id}`);
  }

  for (const category of policy.defaults.categories) {
  if (!categoryNames.includes(category)) errors.push(`Unknown default category: ${category}`);
  }
  for (const genre of policy.defaults.genres) {
  if (!genreNames.includes(genre)) errors.push(`Unknown default genre: ${genre}`);
  }
  for (const key of ["source", "recency", "product_match", "ad_intent", "engagement"]) {
  if (!Number.isFinite(policy.discovery_score_weights[key])) errors.push(`Discovery score weight missing: ${key}`);
  }
  const discoveryWeightTotal = Object.values(policy.discovery_score_weights).reduce((total, value) => total + value, 0);
  if (discoveryWeightTotal !== 100) errors.push(`Discovery score weights must total 100, got ${discoveryWeightTotal}`);
  const visualWeightTotal = Object.values(policy.visual_quality_gate.score_weights).reduce((total, value) => total + value, 0);
  if (visualWeightTotal !== 100) errors.push(`Visual quality weights must total 100, got ${visualWeightTotal}`);
  if (policy.visual_quality_gate.minimum_score < 70) errors.push("Visual quality minimum must be at least 70");
  if (policy.visual_quality_gate.minimum_product_frame_ratio < 0.35) errors.push("Product evidence ratio minimum must be at least 0.35");
  if (!policy.classification.search_genres_are_recall_only) errors.push("Search genres must remain recall-only");
  if (!policy.classification.require_visual_review_before_formal_genres) errors.push("Visual review must precede formal genres");

  return {
    policy: path.relative(collectDir, policyPath),
    industry: brands.industry || policy.industry || taxonomy.industry || "Unknown",
    ok: errors.length === 0,
    categories: categoryNames.length,
    genres: genreNames.length,
    category_brand_relations: Object.values(brands.categories).flat().length,
    unique_brands: allBrands.size,
    verified_sources: (sources.sources || []).filter((item) => item.active).length,
    errors,
    warnings,
  };
}

const args = parseArgs(process.argv.slice(2));
const results = await Promise.all(args.policies.map((policyFile) => validatePolicy(policyFile)));
const summary = {
  ok: results.every((result) => result.ok),
  policies: results,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
