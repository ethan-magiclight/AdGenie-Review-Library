#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { inspectImage, loadPlaywright, normalizeLogo, resolveChromeExecutable, today } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(collectRoot, "brand-assets-v3");
const registryPath = path.join(outputRoot, "registry.json");
const collectedAt = today();

function parseArgs(argv) {
  const options = { limit: 20, brandIds: [], statuses: ["asset_collection_needs_review"], force: false, executablePath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--brand") options.brandIds.push(argv[++index]);
    else if (argument === "--status") options.statuses.push(argv[++index]);
    else if (argument === "--executable-path") options.executablePath = argv[++index];
    else if (argument === "--force") options.force = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  return options;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function writeRegistry(registry) {
  registry.summary = registry.brands.reduce((summary, record) => {
    summary.brand_count = registry.brands.length;
    summary[record.status] = (summary[record.status] ?? 0) + 1;
    return summary;
  }, {});
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !["the", "and", "brand", "logo"].includes(word));
}

async function rankedLogoElements(page, brand) {
  const brandWords = normalizedWords(brand.display_name);
  const candidates = await page.locator("img, svg, [role='img']").evaluateAll((nodes, input) => nodes.map((node, index) => {
    const { words, brandName } = input;
    const box = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const identity = [
      node.getAttribute("alt"), node.getAttribute("aria-label"), node.getAttribute("title"),
      node.getAttribute("id"), node.getAttribute("class"), node.getAttribute("src"),
    ].filter(Boolean).join(" ");
    const ancestry = [];
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      ancestry.push(`${parent.tagName} ${parent.id || ""} ${parent.className || ""}`);
    }
    const haystack = `${identity} ${ancestry.join(" ")}`.toLowerCase();
    const normalizedAlt = String(node.getAttribute("alt") ?? "").normalize("NFKD").replace(/[^a-z0-9]+/gi, "").toLowerCase();
    const normalizedBrand = String(brandName).normalize("NFKD").replace(/[^a-z0-9]+/gi, "").toLowerCase();
    let score = 0;
    if (normalizedAlt && normalizedAlt === normalizedBrand) score += 160;
    if (/logo|logotype|brandmark|brand-mark/.test(haystack)) score += 80;
    if (/header|navbar|nav-bar|site-header|masthead/.test(haystack)) score += 45;
    if (ancestry.some((value) => /^NAV\b|^HEADER\b/.test(value))) score += 35;
    const matchingWords = words.filter((word) => haystack.includes(word)).length;
    score += matchingWords * 35;
    if (matchingWords === words.length && words.length > 0) score += 35;
    if (/footer/.test(haystack)) score -= 20;
    if (/payment|partner|sponsor|social|facebook|instagram|youtube|twitter|tiktok|linkedin|store-badge/.test(haystack)) score -= 120;
    if (box.width >= 20 && box.height >= 16) score += 20;
    if (box.width > 700 || box.height > 400) score -= 80;
    const visible = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0;
    return {
      index, score, visible, identity: identity.slice(0, 500), ancestry: ancestry.join(" > ").slice(0, 800),
      tag: node.tagName.toLocaleLowerCase(), width: box.width, height: box.height,
      source_url: node.currentSrc || node.getAttribute("src") || null,
    };
  }), { words: brandWords, brandName: brand.display_name });
  return candidates
    .filter((candidate) => candidate.visible && candidate.score >= 80)
    .sort((left, right) => right.score - left.score || (right.width * right.height) - (left.width * left.height));
}

async function collectRenderedLogo(browser, brand) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 4,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    if (["media", "font"].includes(route.request().resourceType())) await route.abort();
    else await route.continue();
  });
  try {
    await page.goto(brand.official_page_url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const candidates = await rankedLogoElements(page, brand);
    const brandRoot = path.join(outputRoot, brand.canonical_brand_id);
    const sourceRoot = path.join(brandRoot, "source");
    const normalizedRoot = path.join(brandRoot, "output");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(normalizedRoot, { recursive: true });
    const attempts = [];
    for (const candidate of candidates.slice(0, 8)) {
      const sourcePath = path.join(sourceRoot, `${brand.canonical_brand_id}-official-page-render.png`);
      try {
        await page.locator("img, svg, [role='img']").nth(candidate.index).screenshot({ path: sourcePath, omitBackground: true, animations: "disabled" });
        const sourceDimensions = await inspectImage(sourcePath);
        if ((sourceDimensions.width ?? 0) < 32 || (sourceDimensions.height ?? 0) < 16) throw new Error("Rendered logo element is too small");
        const normalizedPath = path.join(normalizedRoot, `${brand.canonical_brand_id}-icon@4x.png`);
        await normalizeLogo(sourcePath, normalizedPath);
        const sourceBuffer = fs.readFileSync(sourcePath);
        const normalizedBuffer = fs.readFileSync(normalizedPath);
        const permissionBlocked = ["kfc", "netflix", "spotify", "un-women-uk"].includes(brand.canonical_brand_id);
        return {
          canonical_brand_id: brand.canonical_brand_id,
          display_name: brand.display_name,
          status: permissionBlocked ? "official_asset_collected_permission_blocked" : "official_asset_rendered_from_official_page_pending_approval",
          official_page_url: brand.official_page_url,
          discovery_method: "rendered_official_page_logo_element",
          rendered_page: { final_url: page.url(), title: await page.title(), element: candidate },
          source: { file: path.relative(outputRoot, sourcePath).split(path.sep).join("/"), mime: "image/png", bytes: sourceBuffer.length, sha256: sha256(sourceBuffer), ...sourceDimensions },
          normalized: { file: path.relative(outputRoot, normalizedPath).split(path.sep).join("/"), mime: "image/png", bytes: normalizedBuffer.length, sha256: sha256(normalizedBuffer), ...await inspectImage(normalizedPath), intended_css_width: 56, intended_css_height: 56 },
          approved_for_product: false,
          permission_status: permissionBlocked ? "express_permission_required" : "legal_review_required",
          collected_at: collectedAt,
          attempts,
        };
      } catch (error) {
        attempts.push({ candidate, error: error.message });
      }
    }
    return {
      canonical_brand_id: brand.canonical_brand_id,
      display_name: brand.display_name,
      status: "rendered_page_logo_needs_review",
      official_page_url: brand.official_page_url,
      discovery_method: "rendered_official_page_logo_element",
      rendered_page: { final_url: page.url(), title: await page.title(), candidates: candidates.slice(0, 20) },
      approved_for_product: false,
      permission_status: "not_reviewed",
      error: candidates.length === 0 ? "No high-confidence logo element found on rendered official page" : "Candidate logo elements could not be captured",
    };
  } finally {
    await context.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const selected = registry.brands.filter((brand) => {
  if (options.brandIds.length > 0 && !options.brandIds.includes(brand.canonical_brand_id)) return false;
  return options.force || options.statuses.includes(brand.status);
}).slice(0, options.limit);
const { chromium } = loadPlaywright();
const executablePath = resolveChromeExecutable(options.executablePath);
const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (let index = 0; index < selected.length; index += 1) {
    const current = selected[index];
    const registryIndex = registry.brands.findIndex((brand) => brand.canonical_brand_id === current.canonical_brand_id);
    try {
      const result = await collectRenderedLogo(browser, current);
      registry.brands[registryIndex] = { ...current, ...result };
      console.log(`${index + 1}/${selected.length} ${current.display_name}: ${result.status}`);
    } catch (error) {
      current.status = "rendered_page_logo_needs_review";
      current.rendered_page_error = error.message;
      console.error(`${index + 1}/${selected.length} ${current.display_name}: ${error.message}`);
    }
    writeRegistry(registry);
  }
} finally {
  await browser.close();
}
writeRegistry(registry);
console.log(JSON.stringify(registry.summary, null, 2));
