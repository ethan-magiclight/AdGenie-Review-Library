#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { curlProxyArgs, inspectImage, normalizeLogo, resolveCurl, today } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const siteRegistryPath = path.join(collectRoot, "brand-official-site-registry-v3.json");
const assetOverridesPath = path.join(collectRoot, "brand-official-asset-overrides-v3.json");
const outputRoot = path.join(collectRoot, "brand-assets-v3");
const registryPath = path.join(outputRoot, "registry.json");
const collectedAt = today();
const curlPath = resolveCurl();

const acceptedSiteStatuses = new Set([
  "verified_preexisting_registry",
  "verified_automated_evidence",
  "verified_direct_domain_evidence",
  "verified_manual_override",
]);

function parseArgs(argv) {
  const options = { limit: 20, retry: false, force: false, brandIds: [], statuses: [], delayMs: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--delay-ms") options.delayMs = Number(argv[++index]);
    else if (argument === "--brand") options.brandIds.push(argv[++index]);
    else if (argument === "--status") options.statuses.push(argv[++index]);
    else if (argument === "--retry") options.retry = true;
    else if (argument === "--force") options.force = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003d", "=")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function applyRecordPolicy(record) {
  const result = { ...record };
  if (["apple", "kfc", "netflix", "spotify", "un-women-uk"].includes(result.canonical_brand_id) && (result.normalized_file || result.normalized?.file)) {
    result.status = "official_asset_collected_permission_blocked";
    result.approved_for_product = false;
    result.permission_status = "express_permission_required";
    result.policy_note = "Official trademark terms require express permission or an approved use case before this artwork is enabled in product UI.";
    return result;
  }
  if (result.status === "official_asset_collected_pending_approval" && result.source?.mime !== "image/svg+xml") {
    const largestSourceDimension = Math.max(result.source?.width ?? 0, result.source?.height ?? 0);
    if (largestSourceDimension > 0 && largestSourceDimension < 128) {
      result.status = "official_asset_collected_quality_upgrade_required";
      result.policy_note = "Official source is below the 128 px raster quality floor; retain for traceability and replace before approval.";
    }
  }
  return result;
}

function extractAttribute(tag, attribute) {
  return decodeHtml(String(tag ?? "").match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1]);
}

function resolveUrl(value, baseUrl) {
  if (!value || /^data:|^javascript:/i.test(value)) return null;
  try { return new URL(decodeHtml(value), baseUrl).href; } catch { return null; }
}

function curlText(url, maxTime = 18) {
  return execFileSync(curlPath, [
    ...curlProxyArgs(), "-L", "--http1.1", "--fail", "--silent", "--show-error", "--compressed",
    "--connect-timeout", "6", "--max-time", String(maxTime),
    "-H", "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    url,
  ], { encoding: "utf8", maxBuffer: 12 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function downloadFile(url, destination, maxTime = 20) {
  const result = execFileSync(curlPath, [
    ...curlProxyArgs(), "-L", "--http1.1", "--fail", "--silent", "--show-error", "--compressed",
    "--connect-timeout", String(Math.min(6, maxTime)), "--max-time", String(maxTime),
    "-H", "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    "-o", destination,
    "-w", "__FINAL_URL__%{url_effective}\n__CONTENT_TYPE__%{content_type}\n",
    url,
  ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return {
    finalUrl: result.match(/__FINAL_URL__(.+)/)?.[1]?.trim() || url,
    contentType: result.match(/__CONTENT_TYPE__(.+)/)?.[1]?.trim().split(";", 1)[0].toLocaleLowerCase("en-US") || null,
  };
}

function candidateScore(type, width, height) {
  const largest = Math.max(Number(width) || 0, Number(height) || 0);
  if (type === "json_ld_logo") return 125;
  if (type === "meta_logo") return 120;
  if (type === "image_logo") return 112 + Math.min(12, Math.floor(largest / 100));
  if (type === "apple_touch_icon") return 102 + Math.min(15, Math.floor(largest / 64));
  if (type === "icon" && largest >= 128) return 98 + Math.min(12, Math.floor(largest / 64));
  if (type === "icon") return 70 + Math.min(15, Math.floor(largest / 16));
  if (type === "default_apple_touch_icon") return 62;
  if (type === "default_svg_icon") return 61;
  if (type === "default_large_icon") return 60;
  if (type === "default_favicon") return 55;
  return 0;
}

function parseSizes(value) {
  const matches = String(value ?? "").match(/(\d+)x(\d+)/i);
  return matches ? { width: Number(matches[1]), height: Number(matches[2]) } : { width: null, height: null };
}

function extractLogoCandidates(html, pageUrl) {
  const candidates = [];
  function add(type, url, details = {}) {
    const resolved = resolveUrl(url, pageUrl);
    if (!resolved || !/^https?:/i.test(resolved)) return;
    const item = { type, url: resolved, ...details };
    item.score = candidateScore(type, item.width, item.height);
    candidates.push(item);
  }

  for (const match of html.matchAll(/"logo"\s*:\s*"([^"]+)"/gi)) add("json_ld_logo", match[1]);
  for (const match of html.matchAll(/"logo"\s*:\s*\{[^{}]*?"url"\s*:\s*"([^"]+)"[^{}]*?\}/gi)) add("json_ld_logo", match[1]);

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = (extractAttribute(tag, "property") || extractAttribute(tag, "name")).toLocaleLowerCase("en-US");
    if (["og:logo", "logo"].includes(property)) add("meta_logo", extractAttribute(tag, "content"));
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = extractAttribute(tag, "rel").toLocaleLowerCase("en-US");
    if (!/(?:^|\s)(?:icon|shortcut icon|apple-touch-icon)(?:\s|$)/.test(rel)) continue;
    const sizes = parseSizes(extractAttribute(tag, "sizes"));
    add(rel.includes("apple-touch-icon") ? "apple_touch_icon" : "icon", extractAttribute(tag, "href"), sizes);
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const identity = [extractAttribute(tag, "alt"), extractAttribute(tag, "aria-label"), extractAttribute(tag, "id"), extractAttribute(tag, "class")].join(" ");
    if (!/logo|logotype|brand-mark|brandmark/i.test(identity)) continue;
    const source = extractAttribute(tag, "src") || extractAttribute(tag, "data-src") || extractAttribute(tag, "data-lazy-src");
    add("image_logo", source, { width: Number(extractAttribute(tag, "width")) || null, height: Number(extractAttribute(tag, "height")) || null, identity: identity.trim() });
  }

  add("default_svg_icon", "/favicon.svg");
  add("default_large_icon", "/android-chrome-512x512.png", { width: 512, height: 512 });
  add("default_large_icon", "/android-chrome-192x192.png", { width: 192, height: 192 });
  add("default_large_icon", "/favicon-196x196.png", { width: 196, height: 196 });
  add("default_large_icon", "/favicon-96x96.png", { width: 96, height: 96 });
  add("default_apple_touch_icon", "/apple-touch-icon.png", { width: 180, height: 180 });
  add("default_favicon", "/favicon.ico");
  const unique = new Map();
  for (const candidate of candidates) {
    const current = unique.get(candidate.url);
    if (!current || candidate.score > current.score) unique.set(candidate.url, candidate);
  }
  return [...unique.values()].sort((left, right) => right.score - left.score);
}

function mimeFromFile(buffer, contentType, url) {
  if (buffer.length >= 8 && buffer.subarray(1, 4).toString("ascii") === "PNG") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("hex") === "00000100") return "image/x-icon";
  const head = buffer.subarray(0, 1024).toString("utf8");
  if (/<svg\b/i.test(head)) return "image/svg+xml";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (contentType?.startsWith("image/")) return contentType;
  const extension = new URL(url).pathname.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "svg") return "image/svg+xml";
  throw new Error(`Downloaded response is not a supported image (${contentType ?? "unknown MIME"})`);
}

function extensionForMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/webp") return "webp";
  if (["image/x-icon", "image/vnd.microsoft.icon"].includes(mime)) return "ico";
  throw new Error(`Unsupported image MIME: ${mime}`);
}

function sanitizeSvg(buffer) {
  const source = buffer.toString("utf8");
  if (!/<svg\b/i.test(source)) throw new Error("SVG root missing");
  if (/<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b/i.test(source)) throw new Error("Unsafe SVG element found");
  if (/\bon[a-z]+\s*=/i.test(source)) throw new Error("SVG event handler found");
  return Buffer.from(source
    .replace(/<\?xml[^>]*>\s*/gi, "")
    .replace(/<!DOCTYPE[^>]*>\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .trim() + "\n", "utf8");
}

function initializeRegistry(sites, existing) {
  const existingById = new Map((existing?.brands ?? []).map((brand) => [brand.canonical_brand_id, brand]));
  return {
    version: 3,
    generated_at: collectedAt,
    source_registry: "../brand-official-site-registry-v3.json",
    standard: { pixel_box: "224x224 PNG", intended_css_box: "56x56", safe_artwork_box: "184x184" },
    brands: sites.brands.map((site) => {
      const current = existingById.get(site.canonical_brand_id);
      if (current) {
        const reconciled = {
          ...current,
          official_page_url: site.official_page_url ?? current.official_page_url,
        };
        if (
          site.status === "verified_campaign_identity_no_official_site"
          && !current.status.startsWith("campaign_frame_")
          && current.status !== "pending_campaign_frame_collection"
        ) {
          reconciled.status = "pending_campaign_frame_collection";
          reconciled.official_page_url = null;
          reconciled.campaign_source = site.evidence;
          delete reconciled.error;
        }
        if (acceptedSiteStatuses.has(site.status) && current.status.startsWith("campaign_frame_")) {
          reconciled.status = "pending_asset_collection";
          delete reconciled.campaign_source;
          delete reconciled.candidate_frames;
          delete reconciled.crop_instruction;
          delete reconciled.error;
        }
        if (current.status === "pending_official_site" && acceptedSiteStatuses.has(site.status)) {
          reconciled.status = "pending_asset_collection";
          delete reconciled.error;
        }
        return applyRecordPolicy(reconciled);
      }
      if (site.status === "verified_campaign_identity_no_official_site") {
        return {
          canonical_brand_id: site.canonical_brand_id,
          display_name: site.display_name,
          status: "pending_campaign_frame_collection",
          official_page_url: null,
          campaign_source: site.evidence,
          source_file: null,
          normalized_file: null,
          approved_for_product: false,
          permission_status: "campaign_asset_review_required",
        };
      }
      return applyRecordPolicy({
        canonical_brand_id: site.canonical_brand_id,
        display_name: site.display_name,
        status: acceptedSiteStatuses.has(site.status) ? "pending_asset_collection" : "pending_official_site",
        official_page_url: site.official_page_url,
        source_file: null,
        normalized_file: null,
        approved_for_product: false,
        permission_status: "not_reviewed",
      });
    }),
  };
}

function summarize(registry) {
  const counts = {};
  for (const brand of registry.brands) counts[brand.status] = (counts[brand.status] ?? 0) + 1;
  return { brand_count: registry.brands.length, ...counts };
}

function writeRegistry(registry) {
  registry.summary = summarize(registry);
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function pageHtml(site) {
  try {
    return { html: curlText(site.official_page_url), method: "official_page_html" };
  } catch (officialError) {
    const jinaUrl = `https://r.jina.ai/http://${new URL(site.official_page_url).host}${new URL(site.official_page_url).pathname}`;
    try {
      return { html: curlText(jinaUrl), method: "jina_discovery_fallback", official_error: officialError.message.split("\n")[0] };
    } catch (jinaError) {
      return {
        html: "",
        method: "official_domain_common_asset_probe",
        official_error: officialError.message.split("\n")[0],
        discovery_fallback_error: jinaError.message.split("\n")[0],
      };
    }
  }
}

async function collectBrand(site, options = {}) {
  const page = options.skipPageFetch
    ? { html: "", method: "official_domain_common_asset_probe_after_page_failure" }
    : pageHtml(site);
  const candidates = options.assetOverride
    ? [{ type: "manual_official_asset_override", url: options.assetOverride.asset_url, score: 1000, evidence_page_url: options.assetOverride.evidence_page_url, evidence: options.assetOverride.evidence }]
    : extractLogoCandidates(page.html, site.official_page_url);
  const attempts = [];
  let lowQualityResult = null;
  for (const candidate of candidates.slice(0, 16)) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adgenie-source-"));
    const tempFile = path.join(tempRoot, "download");
    try {
      const response = downloadFile(candidate.url, tempFile, options.skipPageFetch ? 6 : 20);
      let buffer = fs.readFileSync(tempFile);
      const mime = mimeFromFile(buffer, response.contentType, response.finalUrl);
      if (mime === "image/svg+xml") buffer = sanitizeSvg(buffer);
      const extension = extensionForMime(mime);
      const brandRoot = path.join(outputRoot, site.canonical_brand_id);
      const sourceRoot = path.join(brandRoot, "source");
      const outputDirectory = path.join(brandRoot, "output");
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(outputDirectory, { recursive: true });
      const sourcePath = path.join(sourceRoot, `${site.canonical_brand_id}-official.${extension}`);
      fs.writeFileSync(sourcePath, buffer);
      const outputPath = path.join(outputDirectory, `${site.canonical_brand_id}-icon@4x.png`);
      await normalizeLogo(sourcePath, outputPath);
      const outputBuffer = fs.readFileSync(outputPath);
      const sourceDimensions = await inspectImage(sourcePath);
      const outputDimensions = await inspectImage(outputPath);
      const result = applyRecordPolicy({
        canonical_brand_id: site.canonical_brand_id,
        display_name: site.display_name,
        status: "official_asset_collected_pending_approval",
        official_page_url: site.official_page_url,
        discovery_method: page.method,
        asset_candidate: candidate,
        source: {
          requested_url: candidate.url,
          final_url: response.finalUrl,
          mime,
          bytes: buffer.length,
          sha256: sha256(buffer),
          width: sourceDimensions.width,
          height: sourceDimensions.height,
          file: path.relative(outputRoot, sourcePath).split(path.sep).join("/"),
        },
        normalized: {
          file: path.relative(outputRoot, outputPath).split(path.sep).join("/"),
          mime: "image/png",
          bytes: outputBuffer.length,
          sha256: sha256(outputBuffer),
          width: outputDimensions.width,
          height: outputDimensions.height,
          intended_css_width: 56,
          intended_css_height: 56,
        },
        approved_for_product: false,
        permission_status: "legal_review_required",
        collected_at: collectedAt,
        attempts,
      });
      if (result.status === "official_asset_collected_quality_upgrade_required") {
        lowQualityResult ??= result;
        attempts.push({ candidate, result: "official raster source below 128 px; continuing to search higher-quality candidates" });
        continue;
      }
      return result;
    } catch (error) {
      attempts.push({ candidate, error: error.message.split("\n")[0] });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  if (lowQualityResult) return { ...lowQualityResult, attempts };
  return {
    canonical_brand_id: site.canonical_brand_id,
    display_name: site.display_name,
    status: "asset_collection_needs_review",
    official_page_url: site.official_page_url,
    discovery_method: page.method,
    approved_for_product: false,
    permission_status: "not_reviewed",
    attempts,
    error: candidates.length === 0 ? "No logo candidate found in official page evidence" : "All official-page asset candidates failed",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(siteRegistryPath)) throw new Error("Run discover-brand-official-sites-v3.mjs first");
  const sites = readJson(siteRegistryPath);
  const existing = fs.existsSync(registryPath) ? readJson(registryPath) : null;
  const assetOverrides = fs.existsSync(assetOverridesPath) ? readJson(assetOverridesPath) : { brands: [] };
  const assetOverrideById = new Map(assetOverrides.brands.map((brand) => [brand.canonical_brand_id, brand]));
  const registry = initializeRegistry(sites, existing);
  const siteById = new Map(sites.brands.map((site) => [site.canonical_brand_id, site]));
  const selected = registry.brands.filter((brand) => {
    if (options.brandIds.length > 0 && !options.brandIds.includes(brand.canonical_brand_id)) return false;
    if (options.statuses.length > 0 && !options.statuses.includes(brand.status)) return false;
    return options.force || brand.status === "pending_asset_collection" || (options.retry && ["asset_collection_needs_review", "asset_collection_network_retry_required", "official_asset_collected_quality_upgrade_required", "rendered_page_logo_needs_review"].includes(brand.status));
  }).slice(0, options.limit);

  for (let index = 0; index < selected.length; index += 1) {
    const current = selected[index];
    const site = siteById.get(current.canonical_brand_id);
    try {
      const result = await collectBrand(site, {
        skipPageFetch: current.status === "asset_collection_network_retry_required" || assetOverrideById.has(current.canonical_brand_id),
        assetOverride: assetOverrideById.get(current.canonical_brand_id),
      });
      const registryIndex = registry.brands.findIndex((brand) => brand.canonical_brand_id === current.canonical_brand_id);
      registry.brands[registryIndex] = result;
      console.log(`${index + 1}/${selected.length} ${current.display_name}: ${result.status}`);
    } catch (error) {
      current.status = /curl|ssl|tls|timed?\s*out|connect|http\s*[45]\d\d/i.test(error.message)
        ? "asset_collection_network_retry_required"
        : "asset_collection_needs_review";
      current.error = error.message;
      console.error(`${index + 1}/${selected.length} ${current.display_name}: ${error.message}`);
    }
    writeRegistry(registry);
    if (index < selected.length - 1 && options.delayMs > 0) await sleep(options.delayMs);
  }
  writeRegistry(registry);
  console.log(JSON.stringify(registry.summary, null, 2));
}

main();
