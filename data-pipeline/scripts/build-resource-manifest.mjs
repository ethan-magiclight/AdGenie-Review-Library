import { readdir } from "node:fs/promises";
import path from "node:path";

import { pipelineRoot, readJson, writeJsonAtomic } from "./lib.mjs";

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function relative(filePath) {
  return path.relative(pipelineRoot, filePath).split(path.sep).join("/");
}

const logoRoot = path.join(pipelineRoot, "resources", "brand-assets");
const contactSheetRoot = path.join(pipelineRoot, "resources", "contact-sheets");
const logoFiles = (await listFiles(logoRoot)).map(relative).sort();
const contactSheets = (await listFiles(contactSheetRoot)).map(relative).sort();
const logoFileSet = new Set(logoFiles);
const logoCatalogPath = path.join(pipelineRoot, "resources", "brand-logo-catalog.json");
const logoCatalog = await readJson(logoCatalogPath);
const brandRule = await readJson(path.join(pipelineRoot, "rules", "mapping", "brand-normalization-map.json"));
const catalogByBrandId = new Map(logoCatalog.brands.map((brand) => [brand.canonical_brand_id, brand]));
const brands = brandRule.canonical_brands.map((mappedBrand) => {
  const conventionalNormalizedFile = `${mappedBrand.canonical_brand_id}/output/${mappedBrand.canonical_brand_id}-icon@4x.png`;
  const conventionalNormalizedPath = `resources/brand-assets/${conventionalNormalizedFile}`;
  const hasConventionalLogo = logoFileSet.has(conventionalNormalizedPath);
  const brand = catalogByBrandId.get(mappedBrand.canonical_brand_id) || {
    canonical_brand_id: mappedBrand.canonical_brand_id,
    display_name: mappedBrand.display_name,
    raw_aliases: mappedBrand.raw_aliases,
    official_page_url: null,
    source_file: null,
    normalized_file: hasConventionalLogo ? conventionalNormalizedPath : null,
    source: null,
    normalized: hasConventionalLogo ? { file: conventionalNormalizedFile } : null,
  };
  const sourcePath = brand.source?.file ? `resources/brand-assets/${brand.source.file}` : null;
  const normalizedPath = brand.normalized?.file ? `resources/brand-assets/${brand.normalized.file}` : null;
  return {
    ...brand,
    display_name: mappedBrand.display_name,
    raw_aliases: mappedBrand.raw_aliases,
    source_file_exists: Boolean(sourcePath && logoFileSet.has(sourcePath)),
    normalized_file_exists: Boolean(normalizedPath && logoFileSet.has(normalizedPath)),
  };
}).sort((left, right) => left.canonical_brand_id.localeCompare(right.canonical_brand_id));
const brandsWithLogo = brands.filter((brand) => brand.normalized_file_exists).length;

await writeJsonAtomic(logoCatalogPath, {
  ...logoCatalog,
  summary: {
    canonical_brand_count: brands.length,
    brands_with_local_normalized_logo: brandsWithLogo,
    brands_without_local_normalized_logo: brands.length - brandsWithLogo,
  },
  brands,
});

await writeJsonAtomic(path.join(pipelineRoot, "resources", "manifest.json"), {
  generated_at: new Date().toISOString(),
  logo_catalog: "resources/brand-logo-catalog.json",
  logo_root: "resources/brand-assets",
  logo_file_count: logoFiles.length,
  logo_files: logoFiles,
  contact_sheet_root: "resources/contact-sheets",
  contact_sheet_count: contactSheets.length,
  contact_sheets: contactSheets,
});

console.log(JSON.stringify({ logo_files: logoFiles.length, contact_sheets: contactSheets.length }, null, 2));
