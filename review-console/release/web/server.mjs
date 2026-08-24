import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  directMediaDescriptor,
  MediaResolutionError,
  publicMediaFields,
  refreshBestAdsMedia,
  refreshStashMediaWithFallback,
  validateBestAdsDirectMediaUrl,
} from "./lib/media-resolver.mjs";
import { buildLibraryStatistics } from "./lib/library-statistics.mjs";
import { industryOptionsForData } from "./lib/library-taxonomy.mjs";
import { brandLogoAssetMap, buildBrandGovernance } from "./lib/brand-governance.mjs";
import { buildClassificationGovernance } from "./lib/classification-governance.mjs";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.dirname(__filename);
const repoRoot = path.resolve(webRoot, "..");
const publicRoot = path.join(webRoot, "public");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const taxonomyPolicyPath = path.join(repoRoot, "collect", "adgenie-taxonomy-v2.json");
const taxonomyV3Path = path.join(repoRoot, "collect", "adgenie-taxonomy-v3.json");
const brandNormalizationMapV2Path = path.join(repoRoot, "collect", "brand-normalization-map-v2.json");
const brandNormalizationMapV1Path = path.join(repoRoot, "collect", "brand-normalization-map-v1.json");
const brandNormalizationMapPath = fssync.existsSync(brandNormalizationMapV2Path) ? brandNormalizationMapV2Path : brandNormalizationMapV1Path;
const brandLogoCatalogV4Path = path.join(repoRoot, "collect", "brand-logo-catalog-v4.json");
const brandLogoCatalogV3Path = path.join(repoRoot, "collect", "brand-logo-catalog-v3.json");
const brandLogoCatalogPath = fssync.existsSync(brandLogoCatalogV4Path) ? brandLogoCatalogV4Path : brandLogoCatalogV3Path;
const brandAuditReportPath = path.join(repoRoot, "collect", "runs", "brand-governance-20260823", "audit-report.json");
const brandRecordRisksPath = path.join(repoRoot, "collect", "runs", "brand-governance-20260823", "record-risks.json");
const brandAssetsRoot = path.join(repoRoot, "collect", "brand-assets-v3");
let taxonomyPolicy = null;
let taxonomyPolicySha256 = null;
try {
  const taxonomyPolicyRaw = fssync.readFileSync(taxonomyPolicyPath, "utf8");
  taxonomyPolicy = JSON.parse(taxonomyPolicyRaw);
  taxonomyPolicySha256 = createHash("sha256").update(taxonomyPolicyRaw).digest("hex");
} catch {
  taxonomyPolicy = null;
}
function readOptionalJsonArtifact(filePath) {
  try {
    const raw = fssync.readFileSync(filePath, "utf8");
    return {
      value: JSON.parse(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return { value: null, sha256: null };
  }
}
const brandNormalizationArtifact = readOptionalJsonArtifact(brandNormalizationMapPath);
const brandLogoCatalogArtifact = readOptionalJsonArtifact(brandLogoCatalogPath);
const brandAuditReportArtifact = readOptionalJsonArtifact(brandAuditReportPath);
const brandRecordRisksArtifact = readOptionalJsonArtifact(brandRecordRisksPath);
const taxonomyV3Artifact = readOptionalJsonArtifact(taxonomyV3Path);
const brandLogoFiles = brandLogoAssetMap(brandLogoCatalogArtifact.value || {}, {
  repoRoot,
  legacyAssetRoot: brandAssetsRoot,
});
const brandReleaseLogoFiles = brandLogoAssetMap(brandLogoCatalogArtifact.value || {}, {
  repoRoot,
  legacyAssetRoot: brandAssetsRoot,
  requireProductApproval: true,
});
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const pendingReviewStatusId = "pending_review";
const remakeStatusId = "needs_remake";
const remadeStatusId = "remade";
const workflowConclusionStatusIds = new Set(["needs_remake", "remade", "parked", "approved", "excluded", "blacklisted"]);
const mediaRefreshBeforeExpiryMs = 5 * 60_000;
const mediaCache = new Map();
const mediaRefreshes = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readState() {
  if (!fssync.existsSync(dataPath)) {
    throw new Error("Missing web/data/creative-library-state.json. Run: npm run import");
  }
  const raw = await fs.readFile(dataPath, "utf8");
  const state = JSON.parse(raw);
  Object.defineProperty(state, "__state_file_sha256", {
    value: createHash("sha256").update(raw).digest("hex"),
    enumerable: false,
  });
  return state;
}

async function writeState(state) {
  state.updated_at = new Date().toISOString();
  await fs.writeFile(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function safeJoin(root, requestPath) {
  const clean = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const resolved = path.resolve(root, clean);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function statusById(state, id) {
  return state.statuses.find((status) => status.id === id);
}

function normalizeWorkflowStatusIds(state, statusIds = []) {
  const next = new Set(statusIds.filter((id) => statusById(state, id)));
  const hasConclusion = [...workflowConclusionStatusIds].some((id) => next.has(id));
  if (hasConclusion) next.delete(pendingReviewStatusId);
  if (next.has(remadeStatusId)) next.delete(remakeStatusId);
  return state.statuses.map((status) => status.id).filter((id) => next.has(id));
}

function videoById(state, id) {
  let decodedId = id;
  try {
    decodedId = decodeURIComponent(id);
  } catch {
    return null;
  }
  return state.videos.find((video) => video.id === decodedId || video.video_id === decodedId);
}

function publicVideo(video) {
  return { ...video, ...publicMediaFields(video) };
}

function taxonomyVersion(taxonomy) {
  return taxonomy?.taxonomy_version || taxonomy?.version || null;
}

function taxonomyV3Video(record) {
  if (!record) return null;
  return {
    version: "taxonomy-v3-preview-v1",
    taxonomy_version: taxonomyVersion(taxonomyV3Artifact.value),
    classification_review_status: record.classification_review_status,
    confidence: record.confidence,
    candidate: { ...(record.candidate || {}) },
    old: { ...(record.old || {}) },
    evidence: Array.isArray(record.evidence) ? record.evidence : [],
    conflicts: Array.isArray(record.conflicts) ? record.conflicts : [],
    manual_review_required: record.manual_review_required === true,
    sidecar_only: true,
  };
}

function taxonomyV3StatisticsVideo(video) {
  const governance = video.taxonomy_v3;
  const candidate = governance?.candidate || {};
  const manual = governance?.manual_review_required === true;
  return {
    ...video,
    industry: candidate.industry || null,
    product_category: candidate.product_category || null,
    classification_review_status: manual ? "pending_review" : "candidate",
    classification_candidate: {
      taxonomy_version: governance?.taxonomy_version || null,
      industry_id: candidate.industry_id || null,
      industry: candidate.industry || null,
      product_category_id: candidate.product_category_id || null,
      product_category: candidate.product_category || null,
      status: manual ? "pending_manual" : "candidate",
      confidence: governance?.confidence || null,
      evidence: governance?.evidence || [],
      conflict_status: governance?.conflicts?.length ? "pending_manual" : "none",
      sidecar_only: true,
    },
  };
}

function candidateIndustryOptionsFromStatistics(statistics, longTailThreshold = 10) {
  const rows = Array.isArray(statistics?.industry_rows) ? statistics.industry_rows : [];
  const options = rows
    .filter((row) => row.industry_key)
    .map((row) => ({
      value: row.industry_key,
      industry: row.industry_key,
      label: row.industry,
      zh: row.industry_zh || null,
      count: Number(row.record_count || 0),
      record_count: Number(row.record_count || 0),
      category_count: (statistics?.category_rows || []).filter((category) => (
        category.industry_key === row.industry_key && category.product_category_key
      )).length,
      tier: Number(row.record_count || 0) < longTailThreshold ? "long_tail" : "active",
      is_long_tail: Number(row.record_count || 0) < longTailThreshold,
      candidate_only: true,
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  const active = options.filter((option) => option.tier === "active");
  const longTail = options.filter((option) => option.tier === "long_tail");
  const unclassifiedCount = rows
    .filter((row) => !row.industry_key)
    .reduce((sum, row) => sum + Number(row.record_count || 0), 0);
  return {
    mode: "taxonomy_v3_candidate_preview",
    threshold: longTailThreshold,
    total_count: Number(statistics?.total?.record_count || 0),
    classified_count: options.reduce((sum, option) => sum + option.count, 0),
    active_count: active.reduce((sum, option) => sum + option.count, 0),
    long_tail_count: longTail.reduce((sum, option) => sum + option.count, 0),
    options,
    active,
    long_tail: longTail,
    omitted_registry: [],
    unclassified: { count: unclassifiedCount },
  };
}

function publicState(state) {
  const generatedAt = new Date().toISOString();
  const publicVideos = state.videos.map(publicVideo);
  const formalSourcePlatforms = new Set(["ads_of_the_world", "best_ads", "stash"]);
  let taxonomyV3Governance = null;
  let taxonomyV3Error = null;
  if (taxonomyV3Artifact.value) {
    try {
      taxonomyV3Governance = buildClassificationGovernance(publicVideos, taxonomyV3Artifact.value, {
        generated_at: generatedAt,
        state_path: dataPath,
        state_sha256: state.__state_file_sha256 || null,
        taxonomy_path: taxonomyV3Path,
        taxonomy_sha256: taxonomyV3Artifact.sha256,
      });
    } catch (error) {
      taxonomyV3Error = error instanceof Error ? error.message : String(error);
    }
  }
  const taxonomyV3ByVideoId = new Map((taxonomyV3Governance?.records || []).map((record) => [record.video_id, record]));
  const videos = publicVideos.map((video) => {
    const preview = taxonomyV3Video(taxonomyV3ByVideoId.get(video.video_id || video.id));
    return preview ? { ...video, taxonomy_v3: preview } : video;
  });
  const formalVideos = videos.filter((video) => formalSourcePlatforms.has(String(video.source_platform || "").toLowerCase()));
  const scopes = [
    ...(taxonomyV3Governance ? [{
      id: "formal_three_sources_v3_preview",
      label: "三渠道 · Taxonomy v3 候选预览",
      source_platforms: [...formalSourcePlatforms],
      include_legacy_youtube: false,
      governance_mode: "candidate_preview",
      taxonomy: taxonomyV3Artifact.value,
      taxonomy_sha256: taxonomyV3Artifact.sha256,
      registry: taxonomyV3Artifact.value,
      videos: formalVideos.map(taxonomyV3StatisticsVideo),
    }] : []),
    {
      id: "formal_three_sources",
      label: "三渠道 · 当前正式字段",
      source_platforms: [...formalSourcePlatforms],
      include_legacy_youtube: false,
      governance_mode: "current_formal_fields",
      taxonomy: taxonomyPolicy || state.taxonomy,
      taxonomy_sha256: taxonomyPolicySha256,
      registry: state,
      videos: formalVideos,
    },
    {
      id: "youtube_legacy",
      label: "历史 YouTube",
      source_platforms: ["youtube"],
      include_legacy_youtube: true,
      governance_mode: "legacy",
      taxonomy: taxonomyPolicy || state.taxonomy,
      taxonomy_sha256: taxonomyPolicySha256,
      registry: state,
      videos: videos.filter((video) => String(video.source_platform || "").toLowerCase() === "youtube"),
    },
    {
      id: "all_library",
      label: "全库（含历史 YouTube）",
      source_platforms: [...new Set(videos.map((video) => String(video.source_platform || "").toLowerCase()).filter(Boolean))],
      include_legacy_youtube: true,
      governance_mode: "mixed_legacy",
      taxonomy: taxonomyPolicy || state.taxonomy,
      taxonomy_sha256: taxonomyPolicySha256,
      registry: state,
      videos,
    },
  ];
  const statistics = {};
  for (const scope of scopes) {
    const aggregate = buildLibraryStatistics(scope.videos, {
      lowFrequencyThreshold: 10,
      includeUnknown: true,
      scope: scope.id,
      state: scope.governance_mode === "candidate_preview" ? null : state,
      taxonomy: scope.taxonomy,
      registry: scope.registry,
    });
    statistics[scope.id] = {
      ...aggregate,
      scope: {
        id: scope.id,
        label: scope.label,
        source_platforms: scope.source_platforms,
        include_legacy_youtube: scope.include_legacy_youtube,
        governance_mode: scope.governance_mode,
      },
      generated_at: generatedAt,
      state_sha256: state.__state_file_sha256 || null,
      taxonomy_version: taxonomyVersion(scope.taxonomy) || state.stats?.taxonomy_version || null,
      methodology_version: state.methodology?.source_collection?.version || state.methodology?.review_version || null,
      statistics_contract_path: "collect/library-statistics-contract-v1.md",
      taxonomy_policy_sha256: scope.taxonomy_sha256,
    };
  }
  const industryOptionsByScope = Object.fromEntries(scopes.map((scope) => [scope.id,
    scope.governance_mode === "candidate_preview"
      ? candidateIndustryOptionsFromStatistics(statistics[scope.id], 10)
      : industryOptionsForData({
        videos: scope.videos,
        industries: state.industries,
        taxonomy: scope.taxonomy,
      }, { longTailThreshold: 10 }),
  ]));
  const brandGovernance = buildBrandGovernance(videos, brandNormalizationArtifact.value || {}, brandLogoCatalogArtifact.value || {}, {
    mapping_source: path.relative(repoRoot, brandNormalizationMapPath).split(path.sep).join("/"),
    mapping_sha256: brandNormalizationArtifact.sha256,
    catalog_source: path.relative(repoRoot, brandLogoCatalogPath).split(path.sep).join("/"),
    catalog_sha256: brandLogoCatalogArtifact.sha256,
    audit_report: brandAuditReportArtifact.value || {},
    audit_report_sha256: brandAuditReportArtifact.sha256,
    record_risks: brandRecordRisksArtifact.value || {},
    record_risks_sha256: brandRecordRisksArtifact.sha256,
    state_sha256: state.__state_file_sha256 || null,
  });
  const { __state_file_sha256: ignoredSha, ...serializableState } = state;
  return {
    ...serializableState,
    videos,
    industry_options: industryOptionsByScope.formal_three_sources_v3_preview || industryOptionsByScope.formal_three_sources,
    industry_options_by_scope: industryOptionsByScope,
    taxonomy_v3: {
      available: Boolean(taxonomyV3Governance),
      version: taxonomyVersion(taxonomyV3Artifact.value),
      status: taxonomyV3Governance?.status || "unavailable",
      contract_path: taxonomyV3Artifact.value?.contract_path || "collect/adgenie-taxonomy-contract-v3.md",
      taxonomy_sha256: taxonomyV3Artifact.sha256,
      error: taxonomyV3Error,
      registry: taxonomyV3Governance?.taxonomy_registry || null,
      summary: taxonomyV3Governance?.summary || null,
    },
    brand_governance: brandGovernance,
    library_statistics: {
      version: "library-statistics-v1",
      generated_at: generatedAt,
      state_sha256: state.__state_file_sha256 || null,
      taxonomy_policy_sha256: taxonomyV3Artifact.sha256 || taxonomyPolicySha256,
      default_scope: taxonomyV3Governance ? "formal_three_sources_v3_preview" : "formal_three_sources",
      contract_path: "collect/library-statistics-contract-v1.md",
      scopes: statistics,
    },
  };
}

function cachedMediaIsFresh(entry) {
  return entry && (!entry.expires_at_ms || entry.expires_at_ms > Date.now() + mediaRefreshBeforeExpiryMs);
}

async function resolveVideoMedia(video, { force = false } = {}) {
  const isBestAds = video.media_provider === "best_ads_signed_mp4";
  const usesVimeoResolver = (video.source_site === "stash" && video.media_provider === "hls")
    || (video.source_site === "ads_of_the_world" && video.media_provider === "vimeo");
  if (!isBestAds && !usesVimeoResolver) return { ...directMediaDescriptor(video), cached: true };
  const key = video.video_id || video.id;
  let stable = null;
  if (isBestAds) {
    try {
      stable = { ...validateBestAdsDirectMediaUrl(video.original_media_url, video), cached: true };
    } catch {
      stable = null;
    }
  }
  if (!force && stable) return stable;
  const cached = mediaCache.get(key);
  if (!force && cachedMediaIsFresh(cached)) return { ...cached, cached: true };
  if (!force && mediaRefreshes.has(key)) return mediaRefreshes.get(key);
  const refresh = (isBestAds
    ? refreshBestAdsMedia(video)
    : refreshStashMediaWithFallback(video, {
      preferProxy: !process.env.VERCEL,
      allowProxyFallback: !process.env.VERCEL,
    }))
    .then((result) => {
      const next = { ...result, cached: false };
      mediaCache.set(key, next);
      return next;
    })
    .catch((error) => {
      if (!stable) throw error;
      return { ...stable, cached: false, fallback: true };
    })
    .finally(() => mediaRefreshes.delete(key));
  mediaRefreshes.set(key, refresh);
  return refresh;
}

function mediaPayload(video, descriptor) {
  return {
    video_id: video.video_id,
    media_provider: video.media_provider,
    playback_url: descriptor.playback_url,
    download_url: descriptor.download_url,
    playback_kind: descriptor.playback_kind || null,
    download_kind: descriptor.download_kind || null,
    download_available: descriptor.download_available === true,
    stable_download_url: publicMediaFields(video).media_download_url,
    media_download_capability: publicMediaFields(video).media_download_capability || null,
    checked_at: descriptor.checked_at,
    expires_at: descriptor.expires_at,
    access_status: descriptor.access_status,
    cached: descriptor.cached,
  };
}

function cloneReviewValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function appendReview(state, video, event) {
  const now = new Date().toISOString();
  const reviewEvent = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video_id: video.video_id,
    action: event.action,
    reason_code: event.reason_code || null,
    reason_text: event.reason_text || "",
    before: cloneReviewValue(event.before),
    after: cloneReviewValue(event.after),
    methodology_candidate: Boolean(event.methodology_candidate),
    created_by: event.created_by || "local-user",
    created_at: now,
  };
  state.review_events.unshift(reviewEvent);
  video.review_events = video.review_events || [];
  video.review_events.unshift(reviewEvent);
  video.updated_at = now;
  return reviewEvent;
}

async function handleApi(req, res, url) {
  const state = await readState();
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(res, 200, publicState(state));
  }

  if (req.method === "GET" && (url.pathname === "/api/brand-governance/manifest" || url.pathname === "/api/brand-governance/video-links")) {
    const governance = buildBrandGovernance(state.videos, brandNormalizationArtifact.value || {}, brandLogoCatalogArtifact.value || {}, {
      mapping_source: path.relative(repoRoot, brandNormalizationMapPath).split(path.sep).join("/"),
      mapping_sha256: brandNormalizationArtifact.sha256,
      catalog_source: path.relative(repoRoot, brandLogoCatalogPath).split(path.sep).join("/"),
      catalog_sha256: brandLogoCatalogArtifact.sha256,
      audit_report: brandAuditReportArtifact.value || {},
      audit_report_sha256: brandAuditReportArtifact.sha256,
      record_risks: brandRecordRisksArtifact.value || {},
      record_risks_sha256: brandRecordRisksArtifact.sha256,
      state_sha256: state.__state_file_sha256 || null,
    });
    if (url.pathname.endsWith("/video-links")) {
      return json(res, 200, {
        version: governance.version,
        status: governance.status,
        scope: governance.scope,
        provenance: governance.provenance,
        summary: governance.summary,
        records: Object.values(governance.video_candidates),
      });
    }
    return json(res, 200, {
      version: governance.version,
      status: governance.status,
      scope: governance.scope,
      contracts: governance.contracts,
      provenance: governance.provenance,
      summary: governance.summary,
      brands: governance.brand_registry,
      routes: {
        video_brand_links: "/api/brand-governance/video-links",
        preview_logo_template: "/brand-logos/{candidate_brand_key}.png",
        preview_download_template: "/brand-logos/{candidate_brand_key}.png?download=1",
        product_release_template: "/brand-logos-release/{brand_id}.png",
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/statuses") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { error: "状态名称不能为空" });
    const existing = state.statuses.find((status) => status.name === name);
    if (existing) return json(res, 200, existing);
    const status = {
      id: `custom_${Date.now()}`,
      name,
      color: body.color || "#64748b",
      is_system: false,
      sort_order: state.statuses.length + 1,
    };
    state.statuses.push(status);
    await writeState(state);
    return json(res, 201, status);
  }

  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "statuses" && parts[2]) {
    const target = statusById(state, parts[2]);
    if (!target) return json(res, 404, { error: "状态不存在" });
    if (target.is_system) return json(res, 400, { error: "系统状态不能删除" });
    state.statuses = state.statuses.filter((status) => status.id !== target.id);
    for (const video of state.videos) {
      video.status_ids = (video.status_ids || []).filter((id) => id !== target.id);
    }
    await writeState(state);
    return json(res, 200, { ok: true });
  }

  if (parts[0] === "api" && parts[1] === "videos" && parts[2]) {
    const video = videoById(state, parts[2]);
    if (!video) return json(res, 404, { error: "视频不存在" });

    if ((req.method === "GET" || req.method === "POST") && parts[3] === "media") {
      const force = req.method === "POST" || url.searchParams.get("refresh") === "1";
      const descriptor = await resolveVideoMedia(video, { force });
      if (req.method === "GET" && parts[4] === "download") {
        if (!descriptor.download_url) {
          return json(res, 409, {
            error: "当前媒体仅支持播放，不提供 MP4 文件下载",
            code: "MEDIA_DOWNLOAD_NOT_AVAILABLE",
            video_id: video.video_id,
            playback_url: descriptor.playback_url,
            playback_kind: descriptor.playback_kind || null,
            checked_at: descriptor.checked_at,
            expires_at: descriptor.expires_at,
            access_status: descriptor.access_status,
          });
        }
        return send(res, 302, "", {
          Location: descriptor.download_url,
          "Cache-Control": "no-store",
        });
      }
      if (!parts[4]) return json(res, 200, mediaPayload(video, descriptor));
    }

    if (req.method === "POST" && parts[3] === "statuses") {
      const body = await parseBody(req);
      const nextIds = normalizeWorkflowStatusIds(state, body.status_ids || []);
      const before = [...(video.status_ids || [])];
      video.status_ids = nextIds;
      const event = appendReview(state, video, {
        action: "status_update",
        before,
        after: nextIds,
        reason_text: body.reason_text || "",
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "classification") {
      const body = await parseBody(req);
      const before = {
        product_category: video.product_category,
        primary_genre: video.primary_genre,
        genres: [...(video.genres || [])],
      };
      video.product_category = body.product_category || video.product_category;
      video.primary_genre = body.primary_genre || null;
      video.genres = [...new Set(body.genres || [])];
      video.secondary_genres = video.genres.filter((genre) => genre !== video.primary_genre);
      const event = appendReview(state, video, {
        action: "classification_update",
        reason_code: body.reason_code || "MANUAL_RECLASSIFICATION",
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
        before,
        after: {
          product_category: video.product_category,
          primary_genre: video.primary_genre,
          genres: video.genres,
        },
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "blacklist") {
      const body = await parseBody(req);
      const blacklisted = body.blacklisted !== false;
      const before = { blacklisted: video.blacklisted, status_ids: [...(video.status_ids || [])] };
      video.blacklisted = blacklisted;
      video.status_ids = video.status_ids || [];
      if (blacklisted && !video.status_ids.includes("blacklisted")) video.status_ids.push("blacklisted");
      if (!blacklisted) video.status_ids = video.status_ids.filter((id) => id !== "blacklisted");
      video.status_ids = normalizeWorkflowStatusIds(state, video.status_ids);
      const event = appendReview(state, video, {
        action: blacklisted ? "blacklist" : "unblacklist",
        reason_code: body.reason_code || (blacklisted ? "MANUAL_BLACKLIST" : "MANUAL_RESTORE"),
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
        before,
        after: { blacklisted: video.blacklisted, status_ids: video.status_ids },
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "review") {
      const body = await parseBody(req);
      const event = appendReview(state, video, {
        action: body.action || "note",
        reason_code: body.reason_code || null,
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }
  }

  return json(res, 404, { error: "API not found" });
}

async function serveStatic(req, res, url) {
  const previewPrefix = "/brand-logos/";
  const releasePrefix = "/brand-logos-release/";
  const logoPrefix = url.pathname.startsWith(releasePrefix) ? releasePrefix : url.pathname.startsWith(previewPrefix) ? previewPrefix : null;
  if (logoPrefix && url.pathname.endsWith(".png")) {
    const encodedId = url.pathname.slice(logoPrefix.length, -".png".length);
    let brandId = "";
    try {
      brandId = decodeURIComponent(encodedId);
    } catch {
      return send(res, 400, "Bad request");
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(brandId)) return send(res, 404, "Not found");
    const releaseRequest = logoPrefix === releasePrefix;
    const asset = (releaseRequest ? brandReleaseLogoFiles : brandLogoFiles).get(brandId);
    if (!asset) return send(res, 404, "Not found");
    try {
      const realRepoRoot = await fs.realpath(repoRoot);
      const realAssetRoot = await fs.realpath(asset.resolved_root);
      const realAssetPath = await fs.realpath(asset.absolute_path);
      if (!realAssetRoot.startsWith(`${realRepoRoot}${path.sep}`) || !realAssetPath.startsWith(`${realAssetRoot}${path.sep}`)) {
        return send(res, 403, "Forbidden");
      }
      const body = await fs.readFile(realAssetPath);
      const assetSha256 = createHash("sha256").update(body).digest("hex");
      const validPng = body.length >= 24
        && body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
        && body.subarray(12, 16).toString("ascii") === "IHDR"
        && body.readUInt32BE(16) === 224
        && body.readUInt32BE(20) === 224;
      if (!validPng || (asset.sha256 && asset.sha256 !== assetSha256) || (asset.bytes !== null && asset.bytes !== body.length)) {
        return send(res, 409, "Logo asset integrity mismatch");
      }
      const downloadRequest = releaseRequest || url.searchParams.get("download") === "1";
      return send(res, 200, body, {
        "Content-Type": "image/png",
        "Content-Length": String(body.length),
        ETag: `"${assetSha256}"`,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "X-AdGenie-Asset-Scope": releaseRequest ? "product_release" : "internal_preview",
        ...(downloadRequest ? { "Content-Disposition": `attachment; filename="${brandId}.png"` } : {}),
      });
    } catch {
      return send(res, 404, "Not found");
    }
  }

  if (url.pathname.startsWith("/media/collect/")) {
    const mediaPath = safeJoin(repoRoot, url.pathname.replace(/^\/media\//, ""));
    if (!mediaPath || !mediaPath.startsWith(path.join(repoRoot, "collect"))) {
      return send(res, 403, "Forbidden");
    }
    try {
      const body = await fs.readFile(mediaPath);
      return send(res, 200, body, {
        "Content-Type": mime[path.extname(mediaPath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      });
    } catch {
      return send(res, 404, "Not found");
    }
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeJoin(publicRoot, pathname);
  if (!filePath) return send(res, 403, "Forbidden");
  try {
    const body = await fs.readFile(filePath);
    return send(res, 200, body, {
      "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  } catch {
    return send(res, 404, "Not found");
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    const status = error instanceof MediaResolutionError ? error.status : 500;
    return json(res, status, { error: error.message, code: error.code || "INTERNAL_ERROR" });
  }
}

export default handleRequest;

const server = http.createServer(handleRequest);

if (!process.env.VERCEL) {
  server.listen(port, host, () => {
    console.log(`AdGenie Creative Library running at http://${host}:${port}`);
  });
}
