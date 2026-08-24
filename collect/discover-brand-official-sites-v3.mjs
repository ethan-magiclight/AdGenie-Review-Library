#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { curlProxyArgs, resolveCurl, today } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const mapPath = path.join(collectRoot, "brand-normalization-map-v1.json");
const inputPath = path.join(collectRoot, "brand-normalization-input-v1.json");
const overridesPath = path.join(collectRoot, "brand-official-site-overrides-v3.json");
const campaignFallbacksPath = path.join(collectRoot, "brand-campaign-logo-fallbacks-v3.json");
const outputPath = path.join(collectRoot, "brand-official-site-registry-v3.json");
const reportPath = path.join(collectRoot, "brand-official-site-report-v3.md");
const productRegistryPaths = [
  "consumer-electronics-top-brands-v1.json",
  "industry-top-brands-v2.json",
  "pet-supplies-top-brands-v1.json",
  "sporting-goods-fitness-top-brands-v1.json",
].map((name) => path.join(collectRoot, name));
const checkedAt = today();
const curlPath = resolveCurl();

const deniedHosts = [
  "amazon.com", "behance.net", "bing.com", "facebook.com", "fandom.com", "instagram.com",
  "linkedin.com", "pinterest.com", "reddit.com", "tiktok.com", "walmart.com", "wikipedia.org",
  "youtube.com",
];

const identityStopwords = new Set([
  "and", "beauty", "brand", "brands", "by", "co", "company", "corporation", "cosmetics",
  "group", "international", "limited", "ltd", "of", "official", "product", "products", "support",
  "the", "uk", "us",
]);

function parseArgs(argv) {
  const options = { limit: 20, retry: false, brandIds: [], delayMs: 1200 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--delay-ms") options.delayMs = Number(argv[++index]);
    else if (argument === "--brand") options.brandIds.push(argv[++index]);
    else if (argument === "--retry") options.retry = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error("--delay-ms must be non-negative");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantTokens(value) {
  return fold(value).split(" ").filter((token) => token.length > 1 && !identityStopwords.has(token));
}

function hostnameAllowed(hostname) {
  const normalized = hostname.replace(/^www\./, "").toLocaleLowerCase("en-US");
  return !deniedHosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function curlText(url, options = {}) {
  const args = [
    ...curlProxyArgs(), "-L", "--http1.1", "--fail", "--silent", "--show-error", "--compressed",
    "--connect-timeout", "6", "--max-time", String(options.maxTime ?? 18),
    "-H", "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  ];
  if (options.getData) {
    args.push("--get");
    for (const [key, value] of Object.entries(options.getData)) args.push("--data-urlencode", `${key}=${value}`);
  }
  args.push(url);
  return execFileSync(curlPath, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function decodeBingTarget(href) {
  try {
    const url = new URL(decodeHtml(href));
    const encoded = url.searchParams.get("u");
    if (encoded?.startsWith("a1")) {
      const target = Buffer.from(encoded.slice(2), "base64").toString("utf8");
      if (/^https?:\/\//i.test(target)) return target;
    }
    if (url.hostname !== "www.bing.com" && url.hostname !== "bing.com") return url.href;
  } catch {}
  return null;
}

function searchBing(query) {
  const html = curlText("https://www.bing.com/search", { getData: { q: query }, maxTime: 12 });
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
  const results = [];
  for (const block of blocks.slice(0, 8)) {
    const heading = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!heading) continue;
    const url = decodeBingTarget(heading[1]);
    if (!url) continue;
    let hostname;
    try { hostname = new URL(url).hostname; } catch { continue; }
    if (!hostnameAllowed(hostname)) continue;
    const snippet = stripTags(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    results.push({ rank: results.length + 1, url, hostname, title: stripTags(heading[2]), snippet });
    if (results.length >= 5) break;
  }
  return results;
}

function extractAttribute(tag, attribute) {
  return decodeHtml(tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1]);
}

function extractPageEvidence(html, requestedUrl) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = {};
  for (const tag of metaTags) {
    const key = extractAttribute(tag, "property") || extractAttribute(tag, "name");
    const content = extractAttribute(tag, "content");
    if (key && content) meta[key.toLocaleLowerCase("en-US")] = content;
  }
  const jsonLdNames = [...html.matchAll(/"(?:name|legalName|alternateName)"\s*:\s*"([^"]{2,120})"/gi)]
    .map((match) => decodeHtml(match[1])).slice(0, 20);
  const canonicalValue = extractAttribute(html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0], "href");
  let canonical = null;
  if (canonicalValue) {
    try { canonical = new URL(canonicalValue, requestedUrl).href; } catch {}
  }
  return {
    requested_url: requestedUrl,
    page_title: title,
    canonical_url: canonical || null,
    site_name: meta["og:site_name"] ?? null,
    application_name: meta["application-name"] ?? null,
    json_ld_names: [...new Set(jsonLdNames)],
    html_bytes: Buffer.byteLength(html),
  };
}

function identityScore(brand, searchResult, page) {
  const tokens = significantTokens(brand.display_name);
  const identityText = fold([
    searchResult.title, searchResult.snippet, page.page_title, page.site_name,
    page.application_name, ...page.json_ld_names,
  ].filter(Boolean).join(" "));
  const domainText = fold(searchResult.hostname.replace(/^www\./, "").split(".")[0]);
  const tokenMatches = tokens.filter((token) => identityText.split(" ").includes(token));
  const domainMatches = tokens.filter((token) => domainText.includes(token));
  const exactNameMatch = identityText.includes(fold(brand.display_name));
  let score = Math.max(0, 32 - ((searchResult.rank - 1) * 6));
  if (exactNameMatch) score += 36;
  else if (tokenMatches.length > 0) score += Math.min(30, tokenMatches.length * 15);
  if (domainMatches.length > 0) score += 20;
  if (page.site_name && fold(page.site_name).includes(fold(brand.display_name))) score += 12;
  if (page.json_ld_names.some((name) => fold(name).includes(fold(brand.display_name)))) score += 12;
  if (page.html_bytes < 500) score -= 30;
  return {
    score: Math.max(0, Math.min(100, score)),
    exact_name_match: exactNameMatch,
    matched_tokens: tokenMatches,
    domain_matched_tokens: domainMatches,
  };
}

function buildContextByBrand(mapping, input) {
  const videosById = new Map(Object.values(input.videos ?? {}).map((video) => [video.video_id || video.id, video]));
  const context = new Map();
  for (const videoMapping of mapping.video_mappings) {
    const video = videosById.get(videoMapping.video_id);
    for (const brand of videoMapping.canonical_brands) {
      const entry = context.get(brand.id) ?? { titles: [], industries: [] };
      if (video?.title && entry.titles.length < 3) entry.titles.push(video.title);
      if (video?.industry && !entry.industries.includes(video.industry)) entry.industries.push(video.industry);
      context.set(brand.id, entry);
    }
  }
  return context;
}

function addProductHints(contextByBrand, canonicalBrands) {
  const idByName = new Map(canonicalBrands.flatMap((brand) => [brand.display_name, ...brand.raw_aliases].map((name) => [fold(name), brand.canonical_brand_id])));
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.brand === "string" && Array.isArray(value.products)) {
      const brandId = idByName.get(fold(value.brand));
      if (brandId) {
        const entry = contextByBrand.get(brandId) ?? { titles: [], industries: [] };
        entry.products = [...new Set([...(entry.products ?? []), ...value.products])];
        contextByBrand.set(brandId, entry);
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const registryPath of productRegistryPaths) visit(readJson(registryPath));
}

function queryForBrand(brand, context) {
  const tokens = significantTokens(brand.display_name);
  const ambiguous = tokens.length <= 1 || tokens.every((token) => token.length <= 4);
  const hints = [];
  if (ambiguous && context?.products?.[0]) hints.push(context.products[0]);
  else if (ambiguous && context?.titles?.[0]) hints.push(context.titles[0].split(/[|:–—-]/)[0].trim());
  if (context?.industries?.[0]) hints.push(context.industries[0]);
  return [`"${brand.display_name}"`, "official website", ...hints].filter(Boolean).join(" ");
}

function directDomainGuesses(brand) {
  const tokens = fold(brand.display_name).split(" ").filter((token) => !["co", "company", "corporation", "group", "limited", "ltd", "the"].includes(token));
  const compact = tokens.join("");
  const withoutAnd = tokens.filter((token) => token !== "and").join("");
  const hyphenated = tokens.join("-");
  return [...new Set([compact, withoutAnd, hyphenated].filter((value) => value.length >= 3).flatMap((value) => [
    `https://www.${value}.com/`,
    `https://${value}.com/`,
  ]))].slice(0, 6);
}

function initializeRegistry(catalog, existing, overrides, campaignFallbacks) {
  const existingById = new Map((existing?.brands ?? []).map((brand) => [brand.canonical_brand_id, brand]));
  const overrideById = new Map(overrides.brands.map((brand) => [brand.canonical_brand_id, brand]));
  const campaignFallbackById = new Map(campaignFallbacks.brands.map((brand) => [brand.canonical_brand_id, brand]));
  const brands = catalog.brands.map((brand) => {
    const override = overrideById.get(brand.canonical_brand_id);
    if (override) {
      return {
        canonical_brand_id: brand.canonical_brand_id,
        display_name: brand.display_name,
        mapped_video_count: brand.mapped_video_count,
        status: "verified_manual_override",
        official_page_url: override.official_page_url,
        official_domains: override.official_domains,
        evidence: override.evidence,
        checked_at: checkedAt,
      };
    }
    const campaignFallback = campaignFallbackById.get(brand.canonical_brand_id);
    if (campaignFallback) {
      return {
        canonical_brand_id: brand.canonical_brand_id,
        display_name: brand.display_name,
        mapped_video_count: brand.mapped_video_count,
        status: "verified_campaign_identity_no_official_site",
        official_page_url: null,
        official_domains: [],
        evidence: {
          method: "review_console_campaign_fallback",
          campaign_title: campaignFallback.campaign_title,
          campaign_page_url: campaignFallback.campaign_page_url,
          media_url: campaignFallback.media_url,
          suggested_frame_seconds: campaignFallback.suggested_frame_seconds,
          note: campaignFallback.evidence,
        },
        checked_at: checkedAt,
      };
    }
    const current = existingById.get(brand.canonical_brand_id);
    if (current) return current;
    if (brand.official_page_url) {
      return {
        canonical_brand_id: brand.canonical_brand_id,
        display_name: brand.display_name,
        mapped_video_count: brand.mapped_video_count,
        status: "verified_preexisting_registry",
        official_page_url: brand.official_page_url,
        official_domains: [new URL(brand.official_page_url).hostname],
        evidence: { method: "existing_official_source_registry" },
        checked_at: checkedAt,
      };
    }
    return {
      canonical_brand_id: brand.canonical_brand_id,
      display_name: brand.display_name,
      mapped_video_count: brand.mapped_video_count,
      status: "pending_discovery",
      official_page_url: null,
      official_domains: [],
      evidence: null,
      checked_at: null,
    };
  });
  return { version: 3, generated_at: checkedAt, source_catalog: "brand-normalization-map-v1.json", brands };
}

function summarize(registry) {
  const counts = {};
  for (const brand of registry.brands) counts[brand.status] = (counts[brand.status] ?? 0) + 1;
  return { brand_count: registry.brands.length, ...counts };
}

function writeRegistry(registry) {
  registry.summary = summarize(registry);
  fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
  const rows = registry.brands
    .sort((left, right) => right.mapped_video_count - left.mapped_video_count || left.display_name.localeCompare(right.display_name))
    .map((brand) => `| ${brand.display_name} | \`${brand.canonical_brand_id}\` | ${brand.mapped_video_count} | ${brand.status} | ${brand.official_page_url ?? "-"} | ${brand.evidence?.identity?.score ?? "-"} |`)
    .join("\n");
  const report = `# AdGenie 品牌官网发现报告 v3\n\n| 指标 | 数量 |\n|---|---:|\n${Object.entries(registry.summary).map(([key, value]) => `| ${key} | ${value} |`).join("\n")}\n\n| 品牌 | ID | 视频数 | 状态 | 官网 | 置信分 |\n|---|---|---:|---|---|---:|\n${rows}\n`;
  fs.writeFileSync(reportPath, report);
}

async function discoverBrand(brand, context) {
  const query = queryForBrand(brand, context);
  const directCandidates = [];
  for (const url of directDomainGuesses(brand)) {
    try {
      const html = curlText(url, { maxTime: 8 });
      const page = extractPageEvidence(html, url);
      const syntheticResult = { rank: 1, url, hostname: new URL(url).hostname, title: "", snippet: "" };
      const identity = identityScore(brand, syntheticResult, page);
      directCandidates.push({ ...syntheticResult, page, identity });
      if (identity.score >= 60) {
        return {
          ...brand,
          status: "verified_direct_domain_evidence",
          official_page_url: page.canonical_url || url,
          official_domains: [new URL(url).hostname],
          checked_at: checkedAt,
          evidence: { query, discovery_method: "direct_domain_candidate", page, identity, candidates: directCandidates },
        };
      }
    } catch (error) {
      directCandidates.push({ url, fetch_error: error.message.split("\n")[0] });
    }
  }
  const results = searchBing(query);
  if (results.length === 0) {
    return { ...brand, status: "discovery_failed", checked_at: checkedAt, evidence: { query, direct_candidates: directCandidates, search_results: [], error: "No eligible search results" } };
  }
  const candidates = [];
  for (const result of results.slice(0, 3)) {
    try {
      const html = curlText(result.url);
      const page = extractPageEvidence(html, result.url);
      const identity = identityScore(brand, result, page);
      candidates.push({ ...result, page, identity });
      if (identity.score >= 70) break;
    } catch (error) {
      candidates.push({ ...result, fetch_error: error.message });
    }
  }
  const winner = candidates.filter((candidate) => candidate.identity).sort((left, right) => right.identity.score - left.identity.score)[0];
  if (!winner) {
    return { ...brand, status: "page_fetch_failed", checked_at: checkedAt, evidence: { query, direct_candidates: directCandidates, search_results: candidates } };
  }
  const verified = winner.identity.score >= 70;
  return {
    ...brand,
    status: verified ? "verified_automated_evidence" : "needs_identity_review",
    official_page_url: winner.page.canonical_url || winner.url,
    official_domains: [new URL(winner.url).hostname],
    checked_at: checkedAt,
    evidence: { query, search_rank: winner.rank, search_title: winner.title, search_snippet: winner.snippet, page: winner.page, identity: winner.identity, direct_candidates: directCandidates, candidates },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mapping = readJson(mapPath);
  const catalog = {
    brands: mapping.canonical_brands.map((brand) => ({
      ...brand,
      mapped_video_count: brand.video_count,
    })),
  };
  const input = readJson(inputPath);
  const overrides = readJson(overridesPath);
  const campaignFallbacks = readJson(campaignFallbacksPath);
  const existing = fs.existsSync(outputPath) ? readJson(outputPath) : null;
  const registry = initializeRegistry(catalog, existing, overrides, campaignFallbacks);
  const contextByBrand = buildContextByBrand(mapping, input);
  addProductHints(contextByBrand, catalog.brands);
  const selected = registry.brands.filter((brand) => {
    if (options.brandIds.length > 0 && !options.brandIds.includes(brand.canonical_brand_id)) return false;
    return brand.status === "pending_discovery" || (options.retry && ["discovery_failed", "page_fetch_failed", "needs_identity_review"].includes(brand.status));
  }).slice(0, options.limit);

  for (let index = 0; index < selected.length; index += 1) {
    const brand = selected[index];
    try {
      const discovered = await discoverBrand(brand, contextByBrand.get(brand.canonical_brand_id));
      const registryIndex = registry.brands.findIndex((item) => item.canonical_brand_id === brand.canonical_brand_id);
      registry.brands[registryIndex] = discovered;
      console.log(`${index + 1}/${selected.length} ${brand.display_name}: ${discovered.status} ${discovered.official_page_url ?? ""}`);
    } catch (error) {
      brand.status = "discovery_error";
      brand.checked_at = checkedAt;
      brand.evidence = { error: error.message };
      console.error(`${index + 1}/${selected.length} ${brand.display_name}: ${error.message}`);
    }
    writeRegistry(registry);
    if (index < selected.length - 1 && options.delayMs > 0) await sleep(options.delayMs);
  }
  writeRegistry(registry);
  console.log(JSON.stringify(registry.summary, null, 2));
}

main();
