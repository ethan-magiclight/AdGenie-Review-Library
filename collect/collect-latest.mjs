import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const currentFile = fileURLToPath(import.meta.url);
const collectDir = path.dirname(currentFile);
const repoRoot = path.resolve(collectDir, "..");

function splitValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    policy: "collection-policy-v1.json",
    categories: [],
    genres: [],
    brands: [],
    formats: [],
    brandTiers: [],
    days: null,
    limitPerSource: null,
    limitPerQuery: null,
    maxQueries: 100,
    maxMetadataFetches: null,
    allowPendingPublishDate: false,
    officialOnly: null,
    includeSearch: true,
    searchAllBrands: false,
    scanCollectHistory: true,
    dryRun: false,
    output: null,
    list: null,
  };

  const valueOptions = new Map([
    ["--genre", "genres"],
    ["--genres", "genres"],
    ["--brand", "brands"],
    ["--brands", "brands"],
    ["--format", "formats"],
    ["--formats", "formats"],
    ["--brand-tier", "brandTiers"],
    ["--brand-tiers", "brandTiers"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--category" || item === "--categories") {
      args.categories.push(String(argv[index + 1] || "").trim());
      index += 1;
    } else if (valueOptions.has(item)) {
      args[valueOptions.get(item)].push(...splitValues(argv[index + 1]));
      index += 1;
    } else if (item === "--policy") {
      args.policy = argv[index + 1];
      index += 1;
    } else if (item === "--days") {
      args.days = Number(argv[index + 1]);
      index += 1;
    } else if (item === "--limit-per-source") {
      args.limitPerSource = Number(argv[index + 1]);
      index += 1;
    } else if (item === "--limit-per-query") {
      args.limitPerQuery = Number(argv[index + 1]);
      index += 1;
    } else if (item === "--max-queries") {
      args.maxQueries = Number(argv[index + 1]);
      index += 1;
    } else if (item === "--max-metadata-fetches") {
      args.maxMetadataFetches = Number(argv[index + 1]);
      index += 1;
    } else if (item === "--allow-pending-publish-date") {
      args.allowPendingPublishDate = true;
    } else if (item === "--output") {
      args.output = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (item === "--allow-unverified") {
      args.officialOnly = false;
    } else if (item === "--official-only") {
      args.officialOnly = true;
    } else if (item === "--no-search") {
      args.includeSearch = false;
    } else if (item === "--search-all-brands") {
      args.searchAllBrands = true;
    } else if (item === "--no-collect-history") {
      args.scanCollectHistory = false;
    } else if (item === "--dry-run") {
      args.dryRun = true;
    } else if (item === "--list-categories") {
      args.list = "categories";
    } else if (item === "--list-genres") {
      args.list = "genres";
    } else if (item === "--list-brands") {
      args.list = "brands";
    } else if (item === "--help" || item === "-h") {
      args.list = "help";
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function resolveInputPath(file, baseDir = collectDir) {
  if (path.isAbsolute(file)) return file;
  if (file.startsWith("collect/")) return path.resolve(repoRoot, file);
  return path.resolve(baseDir, file);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function expandCategoryValues(values, categoryNames) {
  return values.flatMap((value) => {
    if (categoryNames.includes(value)) return [value];
    return splitValues(value);
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function youtubeIdFromUrl(url = "") {
  return (
    url.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1] ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1] ||
    url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/)?.[1] ||
    url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/)?.[1] ||
    null
  );
}

function normalizedUrl(platform, postId, url) {
  if (platform === "youtube" && postId) return `https://www.youtube.com/watch?v=${postId}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["feature", "si"].includes(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url || null;
  }
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function xmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`))?.[1] || "");
}

function xmlAttribute(block, tag, attribute) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(block.match(new RegExp(`<${escapedTag}[^>]*${escapedAttribute}="([^"]+)"`))?.[1] || "");
}

function parseRss(xml) {
  const records = new Map();
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const videoId = xmlTag(entry, "yt:videoId");
    if (!videoId) continue;
    records.set(videoId, {
      video_id: videoId,
      title: xmlTag(entry, "title"),
      published_at: xmlTag(entry, "published") || null,
      updated_at: xmlTag(entry, "updated") || null,
      description: xmlTag(entry, "media:description") || null,
      view_count: Number(xmlAttribute(entry, "media:statistics", "views")) || null,
      url: xmlAttribute(entry, "link", "href") || null,
    });
  }
  return records;
}

function bestDimensions(thumbnails = []) {
  const valid = thumbnails.filter((item) => Number(item.width) > 0 && Number(item.height) > 0);
  return valid.sort((left, right) => right.width * right.height - left.width * left.height)[0] || null;
}

function aspectRatio(width, height) {
  if (!(width > 0 && height > 0)) return "unknown";
  const ratio = width / height;
  const ratios = [
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["4:5", 4 / 5],
    ["1:1", 1],
  ];
  const match = ratios.find(([, target]) => Math.abs(ratio - target) <= 0.08);
  return match?.[0] || `${width}:${height}`;
}

function daysOld(value, now) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function productMatchScore(brandEntry, text) {
  const normalized = normalizeText(text);
  const brandText = normalizeText(brandEntry.brand);
  const brandTokens = new Set(normalizeText(brandEntry.brand).split(" "));
  const genericSingleTerms = new Set([
    "ear",
    "buds",
    "earbuds",
    "headphones",
    "speaker",
    "phone",
    "watch",
    "tablet",
    "laptop",
    "charger",
    "cable",
    "camera",
    "router",
    "monitor",
    "keyboard",
    "mouse",
    "microphone",
    "drive",
    ...(brandEntry.generic_terms || []),
  ]);
  const phrases = brandEntry.products.map((product) => {
    const original = normalizeText(product);
    const stripped = original
      .split(" ")
      .filter((token) => !brandTokens.has(token))
      .join(" ");
    return { original, stripped };
  });
  const originalMatch = phrases.find((item) => item.original && normalized.includes(item.original));
  if (originalMatch) return { matched: true, score: 20, evidence: originalMatch.original };
  const strippedMatch = phrases.find((item) => {
    if (!item.stripped || !normalized.includes(item.stripped)) return false;
    const tokens = item.stripped.split(" ");
    return tokens.length >= 2 || (item.stripped.length >= 5 && !genericSingleTerms.has(item.stripped));
  });
  if (strippedMatch) return { matched: true, score: 18, evidence: strippedMatch.stripped };
  const brandContextMatch = brandEntry.allow_brand_context_match
    && brandText
    && normalized.includes(brandText)
    && (brandEntry.brand_context_terms || []).some((term) => normalized.includes(normalizeText(term)));
  if (brandContextMatch) return { matched: true, score: 14, evidence: `${brandText}+category_context` };
  return { matched: false, score: 0, evidence: null };
}

async function fetchRss(channelId, cache) {
  if (cache.has(channelId)) return cache.get(channelId);
  const promise = (async () => {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-L",
        "-sS",
        "--fail",
        "--max-time",
        "20",
        "-A",
        "AdGenieCollector/1.0",
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return parseRss(stdout);
  })();
  cache.set(channelId, promise);
  return promise;
}

async function runYtDlp(url, limit, ytDlpPath) {
  const { stdout } = await execFileAsync(
    ytDlpPath,
    ["--flat-playlist", "--dump-single-json", "--playlist-end", String(limit), "--no-warnings", url],
    { maxBuffer: 24 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function fetchVideoDetails(videoId, ytDlpPath, cache) {
  if (cache.has(videoId)) return cache.get(videoId);
  const promise = (async () => {
    const { stdout } = await execFileAsync(
      ytDlpPath,
      ["--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist", `https://www.youtube.com/watch?v=${videoId}`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  })();
  cache.set(videoId, promise);
  return promise;
}

function publishedAtFromDetails(details = {}) {
  if (details.timestamp) return new Date(Number(details.timestamp) * 1000).toISOString();
  if (/^\d{8}$/.test(String(details.upload_date || ""))) {
    return `${String(details.upload_date).slice(0, 4)}-${String(details.upload_date).slice(4, 6)}-${String(details.upload_date).slice(6, 8)}T00:00:00.000Z`;
  }
  return details.release_date && /^\d{8}$/.test(String(details.release_date))
    ? `${String(details.release_date).slice(0, 4)}-${String(details.release_date).slice(4, 6)}-${String(details.release_date).slice(6, 8)}T00:00:00.000Z`
    : null;
}

function applyVideoDetails(candidate, details, now) {
  const dimensions = bestDimensions(details.thumbnails || []);
  const width = dimensions?.width || details.width || candidate.width;
  const height = dimensions?.height || details.height || candidate.height;
  const publishedAt = candidate.published_at || publishedAtFromDetails(details);
  return {
    ...candidate,
    title: candidate.title || details.title || "",
    description: candidate.description || details.description || details.fulltitle || null,
    source_account: candidate.source_account || details.channel || details.uploader || null,
    source_account_id: candidate.source_account_id || details.channel_id || details.uploader_id || null,
    width,
    height,
    aspect_ratio: candidate.aspect_ratio !== "unknown" ? candidate.aspect_ratio : aspectRatio(width, height),
    is_vertical: candidate.is_vertical || aspectRatio(width, height) === "9:16",
    view_count: candidate.view_count ?? details.view_count ?? null,
    duration_seconds: candidate.duration_seconds ?? (Number.isFinite(details.duration) ? details.duration : null),
    publish_date: publishedAt ? publishedAt.slice(0, 10) : candidate.publish_date,
    published_at: publishedAt || candidate.published_at,
    age_days: publishedAt ? daysOld(publishedAt, now) : candidate.age_days,
    metadata_status: publishedAt ? "enriched" : candidate.metadata_status,
  };
}

async function collectJsonFiles(root) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
}

function collectSeenFromValue(value, seen) {
  if (Array.isArray(value)) {
    for (const item of value) collectSeenFromValue(item, seen);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const key of ["video_id", "source_post_id", "canonical_master_id"]) {
    if (typeof value[key] === "string" && value[key]) seen.ids.add(value[key]);
  }
  for (const key of ["url", "webpage_url", "source_url"]) {
    if (typeof value[key] !== "string") continue;
    const videoId = youtubeIdFromUrl(value[key]);
    if (videoId) seen.ids.add(videoId);
    const normalized = normalizedUrl(videoId ? "youtube" : "unknown", videoId, value[key]);
    if (normalized) seen.urls.add(normalized);
  }
  for (const child of Object.values(value)) collectSeenFromValue(child, seen);
}

async function loadSeen(policy, outputPath, options = {}) {
  const seen = { ids: new Set(), urls: new Set(), files: [] };
  const files = [];
  const statePath = path.resolve(collectDir, policy.dedupe.state_file);
  files.push(statePath);
  if (policy.dedupe.scan_collect_json && options.scanCollectHistory !== false) files.push(...(await collectJsonFiles(collectDir)));

  for (const file of unique(files.map((item) => path.resolve(item)))) {
    if (outputPath && file === path.resolve(outputPath)) continue;
    try {
      collectSeenFromValue(await readJson(file), seen);
      seen.files.push(path.relative(repoRoot, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Unable to parse dedupe file ${file}: ${error.message}`);
    }
  }
  return seen;
}

function recencyScore(age, policy) {
  if (age === null) return 0;
  const [first, second, third, fourth] = policy.recency_bands_days;
  if (age <= first) return 15;
  if (age <= second) return 12;
  if (age <= third) return 9;
  if (age <= fourth) return 4;
  return 0;
}

function engagementScore(viewCount) {
  if (viewCount >= 1_000_000) return 10;
  if (viewCount >= 100_000) return 8;
  if (viewCount >= 10_000) return 6;
  if (viewCount >= 1_000) return 4;
  if (viewCount > 0) return 2;
  return 0;
}

function listFromPolicy(policy, pathKeys, fallback = []) {
  let current = policy;
  for (const key of pathKeys) {
    current = current?.[key];
    if (current === undefined) return fallback;
  }
  return Array.isArray(current) ? current : fallback;
}

function adIntentScore(candidate, policy) {
  const text = normalizeText(`${candidate.title || ""}\n${candidate.description || ""}`);
  const strong = listFromPolicy(policy, ["ad_intent", "strong_terms"]).filter((term) => text.includes(normalizeText(term)));
  const supporting = listFromPolicy(policy, ["ad_intent", "supporting_terms"]).filter((term) => text.includes(normalizeText(term)));
  const socialFiller = listFromPolicy(policy, ["ad_intent", "social_filler_terms"]).filter((term) => text.includes(normalizeText(term)));
  const petCuteOnly = listFromPolicy(policy, ["ad_intent", "pet_cute_only_terms"]).filter((term) => text.includes(normalizeText(term)));
  let score = Math.min(30, strong.length * 15 + supporting.length * 6);
  if (socialFiller.length) score = Math.max(0, score - 20);
  if (petCuteOnly.length) score = Math.max(0, score - 15);
  return { score, strong, supporting, social_filler: socialFiller, pet_cute_only: petCuteOnly };
}

function scoreCandidate(candidate, policy, product) {
  const source = Math.round(((policy.source_priority[candidate.source_account_type] || 0) / 30) * 20);
  const recency = recencyScore(candidate.age_days, policy);
  const productMatch = Math.round((product.score / 20) * 25);
  const adIntent = adIntentScore(candidate, policy);
  const engagement = engagementScore(candidate.view_count);
  const breakdown = { source, recency, product_match: productMatch, ad_intent: adIntent.score, engagement };
  return {
    score: Object.values(breakdown).reduce((total, value) => total + value, 0),
    breakdown,
    adIntent,
  };
}

function hardFilter(candidate, product, policy, options) {
  const reasons = [];
  const normalizedTitle = normalizeText(`${candidate.title || ""} ${candidate.description || ""}`);
  if (!product.matched) reasons.push("PRODUCT_NOT_MATCHED");
  if (policy.hard_filters.excluded_title_terms.some((term) => normalizedTitle.includes(normalizeText(term)))) {
    reasons.push("EXCLUDED_CONTENT_TERM");
  }
  for (const [code, patterns] of Object.entries(policy.hard_filters.excluded_title_patterns || {})) {
    if ((patterns || []).some((pattern) => new RegExp(pattern, "i").test(`${candidate.title || ""} ${candidate.description || ""}`))) {
      reasons.push(code);
    }
  }
  const categoryExcluded = policy.hard_filters.category_excluded_terms[candidate.product_category] || [];
  if (categoryExcluded.some((term) => normalizedTitle.includes(normalizeText(term)))) {
    reasons.push("CATEGORY_EXCLUDED_TERM");
  }
  if (
    policy.hard_filters.require_known_publish_date
    && candidate.age_days === null
    && !options.allowPendingPublishDate
  ) {
    reasons.push("PUBLISH_DATE_UNKNOWN");
  }
  if (candidate.age_days !== null && candidate.age_days > options.days) reasons.push("OUTSIDE_RECENCY_WINDOW");
  if (candidate.duration_seconds !== null) {
    const { min, max } = policy.hard_filters.duration_seconds;
    if (candidate.duration_seconds < min || candidate.duration_seconds > max) reasons.push("DURATION_OUT_OF_RANGE");
  }
  if (!options.formats.includes(candidate.platform_format)) reasons.push("PLATFORM_FORMAT_NOT_SELECTED");
  if (!policy.hard_filters.allowed_aspect_ratios.includes(candidate.aspect_ratio)) reasons.push("ASPECT_RATIO_NOT_ALLOWED");
  if (options.officialOnly && !candidate.source_account_type.startsWith("official_")) reasons.push("SOURCE_NOT_VERIFIED_OFFICIAL");
  for (const [code, terms] of Object.entries(policy.hard_filters.industry_excluded_terms || {})) {
    if ((terms || []).some((term) => normalizedTitle.includes(normalizeText(term)))) reasons.push(code);
  }
  return unique(reasons);
}

function candidateFromEntry({ entry, rssRecord, source, category, brandEntry, format, now, discovery }) {
  const videoId = entry.id || youtubeIdFromUrl(entry.url);
  const dimensions = bestDimensions(entry.thumbnails || []);
  const width = dimensions?.width || null;
  const height = dimensions?.height || null;
  const ratio = aspectRatio(width, height);
  const entryPublishedAt = entry.timestamp
    ? new Date(Number(entry.timestamp) * 1000).toISOString()
    : /^\d{8}$/.test(String(entry.upload_date || ""))
      ? `${String(entry.upload_date).slice(0, 4)}-${String(entry.upload_date).slice(4, 6)}-${String(entry.upload_date).slice(6, 8)}T00:00:00.000Z`
      : null;
  const publishedAt = rssRecord?.published_at || entryPublishedAt;
  const url = entry.url || rssRecord?.url || `https://www.youtube.com/watch?v=${videoId}`;
  return {
    video_id: videoId,
    source_platform: "youtube",
    source_post_id: videoId,
    platform_format: format,
    url,
    normalized_url: normalizedUrl("youtube", videoId, url),
    title: rssRecord?.title || entry.title || "",
    description: rssRecord?.description || entry.description || null,
    brand: brandEntry.brand,
    industry: brandEntry.industry || source.industry || "Consumer Electronics",
    product_category: category,
    recall_genres: [],
    genres: [],
    primary_genre: null,
    secondary_genres: [],
    source_type: "品牌官方",
    publisher_role: source.account_type,
    source_account: source.handle || entry.channel || null,
    source_account_id: source.channel_id || entry.channel_id || null,
    source_account_type: source.account_type,
    width,
    height,
    aspect_ratio: ratio,
    is_vertical: ratio === "9:16" || format === "shorts",
    is_paid_ad: false,
    view_count: rssRecord?.view_count ?? entry.view_count ?? null,
    duration_seconds: Number.isFinite(entry.duration) ? entry.duration : null,
    publish_date: publishedAt ? publishedAt.slice(0, 10) : null,
    published_at: publishedAt,
    age_days: daysOld(publishedAt, now),
    discovery_source: discovery,
    discovery_matches: [],
    canonical_master_id: videoId,
    review_status: "pending_visual_review",
    metadata_status: publishedAt ? "partial" : "publish_date_missing",
  };
}

function sourceForSearchEntry(entry, brand, sourcesByChannel, sourcesByHandle) {
  const source = sourcesByChannel.get(entry.channel_id);
  if (source?.brand === brand) return source;
  const possibleHandles = [
    entry.channel,
    entry.uploader,
    entry.channel_url,
    entry.uploader_url,
    entry.url,
  ]
    .map((value) => String(value || "").match(/@([A-Za-z0-9._-]+)/)?.[1] || String(value || "").replace(/^@/, ""))
    .map((value) => normalizeText(value))
    .filter(Boolean);
  for (const handle of possibleHandles) {
    const handleSource = sourcesByHandle.get(handle);
    if (handleSource?.brand === brand) return handleSource;
  }
  return {
    id: null,
    brand,
    platform: "youtube",
    account_type: "unverified",
    handle: entry.channel || entry.uploader || null,
    channel_id: entry.channel_id || null,
  };
}

async function discoverOfficialFeeds(context) {
  const { sources, selectedBrands, selectedCategories, options, ytDlpPath, rssCache, now } = context;
  const discovered = [];
  const errors = [];
  const jobs = [];

  for (const source of sources.filter((item) => item.active && item.platform === "youtube")) {
    const brandSelections = selectedBrands.filter((item) => item.brand === source.brand);
    if (!brandSelections.length) continue;
    for (const format of options.formats.filter((item) => source.formats.includes(item))) {
      jobs.push({ source, format, brandSelections });
    }
  }

  for (let index = 0; index < jobs.length; index += 4) {
    const batch = jobs.slice(index, index + 4);
    const payloads = await Promise.all(
      batch.map(async (job) => {
        const url = `${job.source.url}/${job.format}`;
        try {
          const playlist = await runYtDlp(url, options.limitPerSource, ytDlpPath);
          let rss = new Map();
          if (job.source.channel_id) {
            try {
              rss = await fetchRss(job.source.channel_id, rssCache);
            } catch (error) {
              errors.push({ source_id: job.source.id, format: job.format, metadata: "youtube_rss", error: error.message });
            }
          }
          return { job, playlist, rss };
        } catch (error) {
          errors.push({ source_id: job.source.id, format: job.format, error: error.message });
          return null;
        }
      }),
    );

    for (const payload of payloads.filter(Boolean)) {
      for (const entry of payload.playlist.entries || []) {
        for (const selection of payload.job.brandSelections) {
          if (!selectedCategories.includes(selection.category)) continue;
          discovered.push(
            candidateFromEntry({
              entry,
              rssRecord: payload.rss.get(entry.id),
              source: payload.job.source,
              category: selection.category,
              brandEntry: selection,
              format: payload.job.format,
              now,
              discovery: "official_account_feed",
            }),
          );
        }
      }
    }
    process.stderr.write(`official feeds ${Math.min(index + 4, jobs.length)}/${jobs.length}\n`);
  }
  return { discovered, errors, coveredBrands: new Set(jobs.map((job) => job.source.brand)) };
}

function buildSearchQueries(selectedBrands, genresByName, options, coveredBrands) {
  const queriesByBrand = [];
  const currentYear = new Date().getFullYear();
  for (const selection of selectedBrands) {
    if (!options.searchAllBrands && coveredBrands.has(selection.brand)) continue;
    const brandQueries = [];
    for (const genreName of options.genres) {
      const genre = genresByName.get(genreName);
      const genreTerms = (genre?.search_terms || []).slice(0, options.maxQueriesPerBrandGenre);
      const terms = unique([...options.adIntentSearchTerms, ...genreTerms]);
      for (const product of selection.products.slice(0, 2)) {
        for (const term of terms) {
          brandQueries.push({
            brandEntry: selection,
            category: selection.category,
            genre: genreName,
            query: `${selection.brand} ${product} ${term} ${currentYear}`,
          });
        }
      }
    }
    queriesByBrand.push(brandQueries);
  }
  const queries = [];
  for (let index = 0; queries.length < options.maxQueries; index += 1) {
    let added = false;
    for (const brandQueries of queriesByBrand) {
      if (!brandQueries[index]) continue;
      queries.push(brandQueries[index]);
      added = true;
      if (queries.length >= options.maxQueries) break;
    }
    if (!added) break;
  }
  return queries;
}

async function discoverSearch(context, coveredBrands) {
  const { selectedBrands, genresByName, options, ytDlpPath, sourcesByChannel, sourcesByHandle, rssCache, now } = context;
  if (!options.includeSearch) return { discovered: [], errors: [], queryCount: 0 };
  const queries = buildSearchQueries(selectedBrands, genresByName, options, coveredBrands);
  const discovered = [];
  const errors = [];

  for (let index = 0; index < queries.length; index += 4) {
    const batch = queries.slice(index, index + 4);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const payload = await runYtDlp(`ytsearch${options.limitPerQuery}:${item.query}`, options.limitPerQuery, ytDlpPath);
          return { item, entries: payload.entries || [] };
        } catch (error) {
          errors.push({ query: item.query, error: error.message });
          return null;
        }
      }),
    );

    for (const result of results.filter(Boolean)) {
      for (const entry of result.entries) {
        const source = sourceForSearchEntry(entry, result.item.brandEntry.brand, sourcesByChannel, sourcesByHandle);
        let rss = new Map();
        if (entry.channel_id && (!options.officialOnly || source.account_type.startsWith("official_"))) {
          try {
            rss = await fetchRss(entry.channel_id, rssCache);
          } catch (error) {
            errors.push({ query: result.item.query, channel_id: entry.channel_id, error: error.message });
          }
        }
        const candidate = candidateFromEntry({
          entry,
          rssRecord: rss.get(entry.id),
          source,
          category: result.item.category,
          brandEntry: result.item.brandEntry,
          format: entry.url?.includes("/shorts/") ? "shorts" : "videos",
          now,
          discovery: "brand_genre_search",
        });
        candidate.recall_genres = [result.item.genre];
        candidate.discovery_matches = [{ genre: result.item.genre, query: result.item.query }];
        candidate.source_type = source.account_type.startsWith("official_") ? "品牌官方" : "待核验来源";
        discovered.push(candidate);
      }
    }
    process.stderr.write(`search queries ${Math.min(index + 4, queries.length)}/${queries.length}\n`);
  }
  return { discovered, errors, queryCount: queries.length };
}

function mergeDiscovered(records) {
  const map = new Map();
  for (const record of records) {
    const key = `${record.source_platform}:${record.source_post_id}:${record.product_category}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
      continue;
    }
    existing.recall_genres = unique([...existing.recall_genres, ...record.recall_genres]);
    existing.discovery_matches = unique([
      ...existing.discovery_matches.map((item) => JSON.stringify(item)),
      ...record.discovery_matches.map((item) => JSON.stringify(item)),
    ]).map((item) => JSON.parse(item));
    if (!existing.published_at && record.published_at) {
      existing.published_at = record.published_at;
      existing.publish_date = record.publish_date;
      existing.age_days = record.age_days;
    }
    if (!existing.description && record.description) existing.description = record.description;
    if (!existing.view_count && record.view_count) existing.view_count = record.view_count;
  }
  return [...map.values()];
}

function chooseBrands(registry, options, policy) {
  const selected = [];
  for (const category of options.categories) {
    for (const entry of registry.categories[category] || []) {
      if (!options.brandTiers.includes(entry.tier)) continue;
      if (options.brands.length && !options.brands.some((brand) => normalizeText(brand) === normalizeText(entry.brand))) continue;
      selected.push({
        ...entry,
        category,
        industry: registry.industry || policy.industry,
        generic_terms: unique([
        ...(policy.product_match?.generic_single_terms || []),
        ...((policy.product_match?.category_generic_terms || {})[category] || []),
        ...(entry.generic_terms || []),
      ]),
        allow_brand_context_match: Boolean(policy.product_match?.allow_brand_context_match),
        brand_context_terms: unique([
          ...(policy.product_match?.brand_context_terms || []),
          ...((policy.product_match?.category_brand_context_terms || {})[category] || []),
          ...(entry.brand_context_terms || []),
        ]),
      });
    }
  }
  return selected;
}

function defaultOutput(now) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(collectDir, "runs", `collection-${stamp}.json`);
}

async function resolveYtDlpPath() {
  const candidates = unique([
    process.env.YT_DLP_PATH,
    process.env.HOME ? path.join(process.env.HOME, ".local", "bin", "yt-dlp") : null,
    "yt-dlp",
  ]);
  for (const candidate of candidates) {
    if (candidate === "yt-dlp") return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return "yt-dlp";
}

function printHelp() {
  console.log(`Usage: node collect/collect-latest.mjs [options]

  --category <name[,name]>      商品品类，可重复
  --genre <name[,name]>         广告题材，可重复；仅用于召回
  --brand <name[,name]>         品牌过滤，可重复
  --format <shorts,videos>      平台内容形态
  --brand-tier <P0,P1,P2>       品牌层级
  --policy <file>               采集规则文件，默认 collect/collection-policy-v1.json
  --days <number>               发布时间窗口
  --limit-per-source <number>   每个官方账号形态读取数量
  --limit-per-query <number>    每条补漏查询读取数量
  --max-queries <number>        本次补漏查询上限
  --max-metadata-fetches <n>    对缺失发布时间/时长候选做详情页补元数据的上限
  --allow-pending-publish-date  允许发布时间缺失的视频进入待补元数据候选；默认仍排除
  --official-only               只保留已验证官方账号
  --allow-unverified            允许待核验搜索来源
  --no-search                   只执行账号直采
  --search-all-brands           已有官方账号的品牌也执行定向补漏
  --no-collect-history          只用审核台 state 去重，不用 collect 历史临时文件去重
  --output <file>               输出独立候选批次
  --dry-run                     运行但不写文件
  --list-categories             列出可选商品品类
  --list-genres                 列出可选广告题材
  --list-brands                 列出所选品类品牌
`);
}

const cli = parseArgs(process.argv.slice(2));
const policyPath = resolveInputPath(cli.policy);
const policy = await readJson(policyPath);
const [taxonomy, genreData, brandRegistry, sourceRegistry] = await Promise.all([
  readJson(resolveInputPath(policy.taxonomy_file, path.dirname(policyPath))),
  readJson(resolveInputPath(policy.genre_file, path.dirname(policyPath))),
  readJson(resolveInputPath(policy.brand_file, path.dirname(policyPath))),
  readJson(resolveInputPath(policy.source_file, path.dirname(policyPath))),
]);

const categoryNames = taxonomy.categories.map((item) => item.category);
const genreNames = genreData.genres.map((item) => item.english);
const defaults = policy.defaults;
const options = {
  categories: unique(cli.categories.length ? expandCategoryValues(cli.categories, categoryNames) : defaults.categories),
  genres: unique(cli.genres.length ? cli.genres : defaults.genres),
  brands: unique(cli.brands),
  formats: unique(cli.formats.length ? cli.formats : defaults.formats),
  brandTiers: unique(cli.brandTiers.length ? cli.brandTiers : defaults.brand_tiers),
  days: cli.days ?? defaults.published_within_days,
  limitPerSource: cli.limitPerSource ?? defaults.limit_per_source,
  limitPerQuery: cli.limitPerQuery ?? defaults.limit_per_query,
  maxQueries: cli.maxQueries,
  maxQueriesPerBrandGenre: defaults.max_queries_per_brand_genre,
  minimumDiscoveryScore: defaults.minimum_discovery_score,
  maxCandidatesPerBrand: defaults.max_candidates_per_brand,
  maxMetadataFetches: cli.maxMetadataFetches ?? defaults.max_metadata_fetches ?? 80,
  allowPendingPublishDate: cli.allowPendingPublishDate,
  adIntentSearchTerms: policy.ad_intent.search_terms,
  officialOnly: cli.officialOnly ?? defaults.official_only,
  includeSearch: cli.includeSearch,
  searchAllBrands: cli.searchAllBrands,
  scanCollectHistory: cli.scanCollectHistory,
};

if (cli.list === "help") {
  printHelp();
  process.exit(0);
}
if (cli.list === "categories") {
  for (const item of taxonomy.categories) console.log(`${item.category}\t${item.zh}\t${item.priority}`);
  process.exit(0);
}
if (cli.list === "genres") {
  for (const item of genreData.genres) console.log(`${item.english}\t${item.chinese}\t${item.group}`);
  process.exit(0);
}

for (const category of options.categories) {
  if (!categoryNames.includes(category)) throw new Error(`Unknown category: ${category}`);
  if (!brandRegistry.categories[category]) throw new Error(`No Top brand registry for category: ${category}`);
}
for (const genre of options.genres) {
  if (!genreNames.includes(genre)) throw new Error(`Unknown genre: ${genre}`);
}
for (const format of options.formats) {
  if (!["shorts", "videos"].includes(format)) throw new Error(`Unsupported format: ${format}`);
}

const selectedBrands = chooseBrands(brandRegistry, options, policy);
if (!selectedBrands.length) throw new Error("No brands matched the selected category, tier and brand filters.");
if (cli.list === "brands") {
  for (const item of selectedBrands) console.log(`${item.category}\t${item.brand}\t${item.tier}\t${item.products.join(" | ")}`);
  process.exit(0);
}

const now = new Date();
const outputPath = cli.output || defaultOutput(now);
const seen = await loadSeen(policy, outputPath, options);
const sources = sourceRegistry.sources || [];
const sourcesByChannel = new Map(sources.filter((item) => item.channel_id).map((item) => [item.channel_id, item]));
const sourcesByHandle = new Map(
  sources
    .filter((item) => item.handle)
    .map((item) => [normalizeText(String(item.handle).replace(/^@/, "")), item]),
);
const genresByName = new Map(genreData.genres.map((item) => [item.english, item]));
const rssCache = new Map();
const detailsCache = new Map();
const ytDlpPath = await resolveYtDlpPath();
const context = {
  sources,
  selectedBrands,
  selectedCategories: options.categories,
  options,
  ytDlpPath,
  rssCache,
  sourcesByChannel,
  sourcesByHandle,
  genresByName,
  now,
};

const officialResult = await discoverOfficialFeeds(context);
const searchResult = await discoverSearch(context, officialResult.coveredBrands);
const merged = mergeDiscovered([...officialResult.discovered, ...searchResult.discovered]);
let metadataFetchCount = 0;
const metadataErrors = [];
const candidates = [];
const excluded = [];
const preScoredMerged = merged
  .map((candidate) => {
    const selection = selectedBrands.find((item) => item.category === candidate.product_category && item.brand === candidate.brand);
    const product = productMatchScore(selection, `${candidate.title || ""}\n${candidate.description || ""}`);
    const scored = scoreCandidate(candidate, policy, product);
    return { candidate, preScore: scored.score, productMatched: product.matched, adIntentScore: scored.adIntent.score };
  })
  .sort((left, right) => {
    const official = Number(right.candidate.source_account_type?.startsWith("official_")) - Number(left.candidate.source_account_type?.startsWith("official_"));
    if (official !== 0) return official;
    const product = Number(right.productMatched) - Number(left.productMatched);
    if (product !== 0) return product;
    const intent = right.adIntentScore - left.adIntentScore;
    if (intent !== 0) return intent;
    return right.preScore - left.preScore;
  });

for (const item of preScoredMerged) {
  const rawCandidate = item.candidate;
  let candidate = rawCandidate;
  const needsMetadata = !candidate.published_at || !candidate.duration_seconds || candidate.aspect_ratio === "unknown";
  const shouldFetchMetadata =
    needsMetadata
    && candidate.source_account_type?.startsWith("official_")
    && metadataFetchCount < options.maxMetadataFetches
    && (item.productMatched || item.adIntentScore > 0 || item.preScore >= options.minimumDiscoveryScore - 10);
  if (shouldFetchMetadata) {
    try {
      const details = await fetchVideoDetails(candidate.video_id, ytDlpPath, detailsCache);
      candidate = applyVideoDetails(candidate, details, now);
      metadataFetchCount += 1;
    } catch (error) {
      metadataErrors.push({ video_id: candidate.video_id, title: candidate.title, error: error.message });
    }
  }
  const selection = selectedBrands.find(
    (item) => item.category === candidate.product_category && item.brand === candidate.brand,
  );
  const product = productMatchScore(selection, `${candidate.title || ""}\n${candidate.description || ""}`);
  const filterReasons = hardFilter(candidate, product, policy, options);
  const scored = scoreCandidate(candidate, policy, product);
  const duplicate = seen.ids.has(candidate.source_post_id) || seen.urls.has(candidate.normalized_url);
  if (duplicate) filterReasons.push("DUPLICATE_EXISTING_LIBRARY_OR_HISTORY");
  if (scored.adIntent.social_filler.length) filterReasons.push("SOCIAL_FILLER_TITLE_SIGNAL");
  if (scored.adIntent.pet_cute_only?.length) filterReasons.push("PET_CUTE_CONTENT_ONLY_TITLE_SIGNAL");
  if (scored.score < options.minimumDiscoveryScore) filterReasons.push("BELOW_MINIMUM_DISCOVERY_SCORE");

  const finalized = {
    ...candidate,
    recall_genres: unique(candidate.recall_genres.length ? candidate.recall_genres : options.genres),
    product_match_evidence: product.evidence,
    discovery_score: scored.score,
    discovery_score_breakdown: scored.breakdown,
    ad_intent_evidence: scored.adIntent,
    quality_score: null,
    quality_score_breakdown: null,
    hard_filter_status: filterReasons.length ? "excluded" : "passed",
    hard_filter_reasons: unique(filterReasons),
    decision_reason_codes: unique([
      "OFFICIAL_SOURCE_CONFIRMED",
      candidate.published_at ? "PUBLISH_DATE_CONFIRMED" : "PUBLISH_DATE_PENDING",
      candidate.is_vertical ? "VERTICAL_FORMAT_COVERAGE" : null,
      "PENDING_VISUAL_AUDIT",
      "PENDING_FORMAL_GENRE_CLASSIFICATION",
    ]),
    collection_rule_version: policy.rule_version,
    collected_at: now.toISOString(),
  };
  if (filterReasons.length) excluded.push(finalized);
  else candidates.push(finalized);
}

candidates.sort((left, right) => {
  const score = right.discovery_score - left.discovery_score;
  if (score !== 0) return score;
  return String(right.published_at || "").localeCompare(String(left.published_at || ""));
});

const balancedCandidates = [];
const brandCounts = new Map();
for (const candidate of candidates) {
  const count = brandCounts.get(candidate.brand) || 0;
  if (count >= options.maxCandidatesPerBrand) {
    excluded.push({ ...candidate, hard_filter_status: "excluded", hard_filter_reasons: ["BRAND_BATCH_CAP_REACHED"] });
    continue;
  }
  balancedCandidates.push(candidate);
  brandCounts.set(candidate.brand, count + 1);
}

const errors = [...officialResult.errors, ...searchResult.errors, ...metadataErrors.map((item) => ({ metadata_video_id: item.video_id, title: item.title, error: item.error }))];
const payload = {
  version: 1,
  generated_at: now.toISOString(),
  collection_rule_version: policy.rule_version,
  scope: {
    industry: brandRegistry.industry || policy.industry || "Unknown",
    policy: path.relative(repoRoot, policyPath),
    categories: options.categories,
    recall_genres: options.genres,
    brands: unique(selectedBrands.map((item) => item.brand)),
    formats: options.formats,
    brand_tiers: options.brandTiers,
    published_within_days: options.days,
    allow_pending_publish_date: options.allowPendingPublishDate,
    official_only: options.officialOnly,
  },
  methodology: {
    genres_are_recall_only: true,
    formal_genres_require_visual_review: true,
    required_frames: policy.classification.required_frames,
    visual_quality_gate: policy.visual_quality_gate,
  },
  summary: {
    selected_brand_count: unique(selectedBrands.map((item) => item.brand)).length,
    configured_source_count: sources.filter((item) => item.active).length,
    dedupe_file_count: seen.files.length,
    known_existing_id_count: seen.ids.size,
    official_feed_records: officialResult.discovered.length,
    search_query_count: searchResult.queryCount,
    search_records: searchResult.discovered.length,
    unique_discovered: merged.length,
    metadata_fetches: metadataFetchCount,
    passed_candidates: balancedCandidates.length,
    excluded_candidates: excluded.length,
    error_count: errors.length,
  },
  candidates: balancedCandidates,
  excluded,
  errors,
};

if (!cli.dryRun) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

console.log(
  JSON.stringify(
    {
      ...payload.summary,
      dry_run: cli.dryRun,
      output: cli.dryRun ? null : path.relative(repoRoot, outputPath),
      error_preview: errors.slice(0, 5),
      candidate_preview: balancedCandidates.slice(0, 10).map((item) => ({
        video_id: item.video_id,
        brand: item.brand,
        product_category: item.product_category,
        title: item.title,
        publish_date: item.publish_date,
        platform_format: item.platform_format,
        aspect_ratio: item.aspect_ratio,
        discovery_score: item.discovery_score,
      })),
    },
    null,
    2,
  ),
);
