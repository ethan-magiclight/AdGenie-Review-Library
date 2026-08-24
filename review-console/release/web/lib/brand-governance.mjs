import path from "node:path";

const FORMAL_SOURCE_IDS = new Set(["ads_of_the_world", "best_ads", "stash"]);
const AUDIT_RESOLUTION_LANES = new Set(["safe_auto", "manual_confirmation", "cannot_determine"]);
const IDENTITY_CONFIRMED_STATUSES = new Set(["source_verified", "human_confirmed"]);
const ASSET_SCOPES = new Set(["internal_preview", "product_release", "permission_blocked"]);
const RELEASE_BLOCKED_PERMISSION_STATUSES = new Set([
  "express_permission_required",
  "identity_and_legal_review_required",
]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function videoId(video) {
  return text(video?.video_id) || text(video?.id);
}

function sourceId(video) {
  return (text(video?.source_site) || text(video?.source_platform)).toLowerCase();
}

function isFormalVideo(video) {
  return FORMAL_SOURCE_IDS.has(sourceId(video));
}

function hasNormalizedLogo(record) {
  return Boolean(record?.normalized?.file || record?.asset_ref?.repo_relative_normalized_path);
}

function logoCandidate(record) {
  if (!record?.canonical_brand_id || !hasNormalizedLogo(record)) return null;
  const permissionStatus = record.permission_status || "unknown";
  const displayAllowed = permissionStatus !== "express_permission_required";
  const approvedForProduct = record.approved_for_product === true;
  const encodedId = encodeURIComponent(record.canonical_brand_id);
  return {
    canonical_brand_id: record.canonical_brand_id,
    display_name: record.display_name || record.canonical_brand_id,
    logo_url: displayAllowed ? `/brand-logos/${encodedId}.png` : null,
    preview_url: displayAllowed ? `/brand-logos/${encodedId}.png` : null,
    preview_download_url: displayAllowed ? `/brand-logos/${encodedId}.png?download=1` : null,
    release_download_url: approvedForProduct ? `/brand-logos-release/${encodedId}.png` : null,
    logo_status: record.logo_status || record.status || "candidate",
    permission_status: permissionStatus,
    approved_for_product: approvedForProduct,
    display_allowed: displayAllowed,
    usage_scope: displayAllowed ? approvedForProduct ? "product_release" : "internal_preview" : "blocked",
    official_page_url: record.official_page_url || null,
    normalized_sha256: record.normalized.sha256 || null,
    normalized_width: record.normalized.width || null,
    normalized_height: record.normalized.height || null,
  };
}

function identityConfirmed(record) {
  if (record?.identity_confirmed === true) return true;
  const statuses = safeStringArray(record?.mapping_statuses);
  return statuses.length > 0 && statuses.every((status) => IDENTITY_CONFIRMED_STATUSES.has(status));
}

function safeStringArray(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function buildBrandGovernance(videos = [], mapping = {}, catalog = {}, metadata = {}) {
  const formalVideos = videos.filter(isFormalVideo);
  const mappingByVideo = new Map((mapping.video_mappings || []).map((record) => [text(record.video_id), record]));
  const catalogByBrand = new Map((catalog.brands || []).map((record) => [text(record.canonical_brand_id), record]));
  const auditReport = metadata.audit_report || {};
  const recordRisks = metadata.record_risks || {};
  const riskByVideo = new Map((recordRisks.records || []).map((record) => [text(record.video_id), record]));
  const currentStateSha256 = text(metadata.state_sha256) || null;
  const auditReportStateSha256 = text(auditReport?.audit?.state_sha256) || null;
  const recordRisksStateSha256 = text(recordRisks?.state_sha256) || null;
  const auditArtifactsComplete = Boolean(auditReportStateSha256 && recordRisksStateSha256 && Array.isArray(recordRisks.records));
  const auditArtifactsAgree = Boolean(auditArtifactsComplete && auditReportStateSha256 === recordRisksStateSha256);
  const auditedStateSha256 = auditArtifactsAgree ? auditReportStateSha256 : null;
  const auditStateMatches = Boolean(auditArtifactsAgree && currentStateSha256 && currentStateSha256 === auditedStateSha256);
  const auditApplied = auditStateMatches;
  const auditFreshnessStatus = !auditArtifactsComplete
    ? "missing"
    : !auditArtifactsAgree
      ? "artifact_mismatch"
      : auditStateMatches
        ? "current"
        : "stale";
  const videoCandidates = {};
  const resolutionLaneCounts = {
    safe_auto: 0,
    manual_confirmation: 0,
    cannot_determine: 0,
    no_flag: 0,
    not_audited: 0,
  };
  let exactMappingCount = 0;
  let recordsWithLogoCandidate = 0;
  let recordsWithDisplayableLogoCandidate = 0;
  let recordsPermissionBlocked = 0;
  let recordsWithoutCanonicalBrand = 0;
  let productApprovedLogoCount = 0;
  let recordsWithAuditRisk = 0;
  const mappingStatusCounts = {};

  for (const video of formalVideos) {
    const id = videoId(video);
    const record = mappingByVideo.get(id);
    if (!id) continue;
    const risk = auditApplied ? riskByVideo.get(id) : null;
    const resolutionLane = auditApplied
      ? AUDIT_RESOLUTION_LANES.has(risk?.resolution_lane) ? risk.resolution_lane : "no_flag"
      : "not_audited";
    resolutionLaneCounts[resolutionLane] += 1;
    if (risk) recordsWithAuditRisk += 1;
    if (record) exactMappingCount += 1;
    const mappingStatus = record?.mapping_status || "unmapped";
    mappingStatusCounts[mappingStatus] = (mappingStatusCounts[mappingStatus] ?? 0) + 1;
    const canonicalBrands = Array.isArray(record?.canonical_brands)
      ? record.canonical_brands.map((brand) => ({ id: text(brand.id), name: text(brand.name) })).filter((brand) => brand.id)
      : [];
    if (record && !canonicalBrands.length) recordsWithoutCanonicalBrand += 1;
    const logoCandidates = canonicalBrands
      .map((brand) => logoCandidate(catalogByBrand.get(brand.id)))
      .filter(Boolean);
    if (logoCandidates.length) recordsWithLogoCandidate += 1;
    if (logoCandidates.some((logo) => logo.display_allowed)) recordsWithDisplayableLogoCandidate += 1;
    if (logoCandidates.some((logo) => !logo.display_allowed)) recordsPermissionBlocked += 1;
    if (logoCandidates.some((logo) => logo.approved_for_product)) productApprovedLogoCount += 1;
    videoCandidates[id] = {
      video_id: id,
      source_site: sourceId(video),
      raw_brand: record?.raw_brand || video.brand || null,
      raw_primary_brand: record?.raw_primary_brand || video.primary_brand || null,
      primary_brand_id: record?.primary_brand_id || null,
      canonical_brands: canonicalBrands,
      brand_ids: canonicalBrands.map((brand) => brand.id),
      mapping_status: record?.mapping_status || "unmapped",
      mapping_method: record?.mapping_method || null,
      mapping_note: record?.note || null,
      logos: logoCandidates,
      product_logo_approved: logoCandidates.length > 0 && logoCandidates.every((logo) => logo.approved_for_product),
      resolution_lane: resolutionLane,
      risk_codes: safeStringArray(risk?.risk_codes),
      suggested_actions: safeStringArray(risk?.suggested_actions),
      title_brand_claim: risk?.title_brand_claim || null,
      audit_rule_version: auditApplied ? text(recordRisks.rule_version || auditReport?.audit?.rule_version) || null : null,
      audit_state_match: auditStateMatches,
      audit_approval_effect: risk?.approval_effect || "none",
      sidecar_only: true,
    };
  }

  const catalogBrands = catalog.brands || [];
  const brandRegistry = (mapping.canonical_brands || []).map((record) => {
    const key = text(record.canonical_brand_id);
    const confirmed = identityConfirmed(record);
    const logo = logoCandidate(catalogByBrand.get(key));
    return {
      candidate_brand_key: key,
      brand_id: confirmed ? key : null,
      display_name: text(record.display_name) || key,
      aliases: safeStringArray(record.raw_aliases),
      source_labels: safeStringArray(record.source_labels),
      mapped_video_count: Number(record.video_count || 0),
      primary_video_count: Number(record.primary_video_count || 0),
      mapping_statuses: safeStringArray(record.mapping_statuses),
      identity_status: confirmed ? "confirmed" : "candidate_review_required",
      identity_review_required: !confirmed,
      logo_collection_readiness: text(record.logo_collection_readiness) || "identity_review_required",
      logo,
      sidecar_only: true,
    };
  }).filter((record) => record.candidate_brand_key)
    .sort((left, right) => right.mapped_video_count - left.mapped_video_count || left.display_name.localeCompare(right.display_name));
  return {
    version: "brand-governance-v2",
    status: "candidate_sidecar",
    scope: {
      id: "formal_three_sources",
      source_sites: [...FORMAL_SOURCE_IDS],
      include_legacy_youtube: false,
    },
    contracts: {
      identity: "collect/brand-identity-contract-v1.md",
      logo_methodology: "collect/brand-logo-methodology-v3.md",
      audit_report: "collect/runs/brand-governance-20260823/audit-report.json",
      record_risks: "collect/runs/brand-governance-20260823/record-risks.json",
    },
    provenance: {
      mapping_version: mapping.version || null,
      mapping_source: metadata.mapping_source || "collect/brand-normalization-map-v1.json",
      mapping_sha256: metadata.mapping_sha256 || null,
      catalog_version: catalog.version || null,
      catalog_source: metadata.catalog_source || (Number(catalog.version) >= 4
        ? "collect/brand-logo-catalog-v4.json"
        : "collect/brand-logo-catalog-v3.json"),
      catalog_sha256: metadata.catalog_sha256 || null,
      audit_rule_version: auditReport?.audit?.rule_version || recordRisks.rule_version || null,
      audit_generated_at: auditReport?.audit?.generated_at || recordRisks.generated_at || null,
      audit_state_sha256: auditedStateSha256,
      audit_report_sha256: metadata.audit_report_sha256 || null,
      record_risks_sha256: metadata.record_risks_sha256 || null,
      current_state_sha256: currentStateSha256,
      audit_state_match: auditStateMatches,
      audit_applied: auditApplied,
      audit_freshness_status: auditFreshnessStatus,
    },
    summary: {
      formal_record_count: formalVideos.length,
      audited_record_count: auditApplied ? formalVideos.length : 0,
      records_with_audit_risk: auditApplied ? recordsWithAuditRisk : 0,
      resolution_lane_counts: resolutionLaneCounts,
      brand_missing_or_placeholder: auditApplied ? Number(auditReport?.field_quality?.brand_missing_or_placeholder || 0) : null,
      dedicated_brand_evidence_fields: auditApplied ? Number(auditReport?.field_quality?.dedicated_brand_evidence_fields || 0) : null,
      exact_mapping_count: exactMappingCount,
      mapping_record_count: exactMappingCount,
      unmatched_record_count: formalVideos.length - exactMappingCount,
      mapping_status_counts: Object.fromEntries(Object.entries(mappingStatusCounts).sort(([left], [right]) => left.localeCompare(right))),
      records_with_logo_candidate: recordsWithLogoCandidate,
      records_with_displayable_logo_candidate: recordsWithDisplayableLogoCandidate,
      records_permission_blocked: recordsPermissionBlocked,
      records_without_canonical_brand: recordsWithoutCanonicalBrand,
      catalog_brand_count: catalogBrands.length,
      catalog_product_approved_brand_count: catalogBrands.filter((brand) => brand.approved_for_product === true).length,
      records_with_product_approved_logo: productApprovedLogoCount,
      candidate_brand_count: brandRegistry.length,
      identity_confirmed_brand_count: brandRegistry.filter((brand) => !brand.identity_review_required).length,
      identity_review_required_brand_count: brandRegistry.filter((brand) => brand.identity_review_required).length,
    },
    brand_registry: brandRegistry,
    video_candidates: videoCandidates,
  };
}

export function brandLogoFileMap(catalog = {}, { requireProductApproval = false } = {}) {
  return new Map((catalog.brands || []).flatMap((record) => {
    const id = text(record.canonical_brand_id);
    const relativePath = Number(catalog.version) >= 4
      ? text(record?.asset_ref?.repo_relative_normalized_path)
      : text(record?.normalized?.file);
    const permissionBlocked = record.permission_status === "express_permission_required";
    const productApproved = record.approved_for_product === true;
    const releaseBlocked = RELEASE_BLOCKED_PERMISSION_STATUSES.has(record.permission_status);
    const assetScope = text(record?.asset_ref?.asset_scope);
    const scopeAllowed = Number(catalog.version) < 4
      ? true
      : ASSET_SCOPES.has(assetScope) && assetScope !== "permission_blocked";
    const releaseAllowed = !requireProductApproval || (
      productApproved
      && !releaseBlocked
      && (Number(catalog.version) < 4 || assetScope === "product_release")
    );
    return id && relativePath && !permissionBlocked && scopeAllowed && releaseAllowed ? [[id, relativePath]] : [];
  }));
}

function portableRelativePath(value, label) {
  const candidate = text(value);
  if (!candidate || candidate.includes("\\") || candidate.includes("\0") || path.posix.isAbsolute(candidate)) {
    throw new Error(`${label} must be a portable repo-relative path`);
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..") || path.posix.normalize(candidate) !== candidate) {
    throw new Error(`${label} contains unsafe path segments: ${candidate}`);
  }
  return candidate;
}

function containedPath(root, relativePath, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its approved root: ${relativePath}`);
  }
  return resolved;
}

function normalizedAssetMetadata(record) {
  const finiteNumber = (value) => value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    mime: text(record?.normalized?.mime) || "image/png",
    bytes: finiteNumber(record?.normalized?.bytes),
    sha256: text(record?.normalized?.sha256) || null,
    width: finiteNumber(record?.normalized?.width),
    height: finiteNumber(record?.normalized?.height),
  };
}

export function resolveBrandLogoAsset(catalog, record, {
  repoRoot,
  legacyAssetRoot,
} = {}) {
  const brandId = text(record?.canonical_brand_id);
  if (!brandId) throw new Error("Logo record is missing canonical_brand_id");
  const catalogVersion = Number(catalog?.version || 0);
  if (catalogVersion >= 4) {
    const assetRef = record?.asset_ref;
    if (!assetRef) return null;
    const assetRootId = text(assetRef.asset_root_id);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(assetRootId)) {
      throw new Error(`${brandId}: asset_ref.asset_root_id is invalid`);
    }
    const assetScope = text(assetRef.asset_scope);
    if (!ASSET_SCOPES.has(assetScope)) throw new Error(`${brandId}: asset_ref.asset_scope is invalid`);
    if (assetScope === "permission_blocked") return null;
    if (!repoRoot) throw new Error(`${brandId}: repoRoot is required for catalog v4 assets`);
    const rootDefinition = catalog?.asset_roots?.[assetRootId];
    if (!rootDefinition) throw new Error(`${brandId}: asset root is not catalog-whitelisted: ${assetRootId}`);
    const repoRelativeRoot = portableRelativePath(rootDefinition.repo_relative_root, `${assetRootId}.repo_relative_root`);
    if (!repoRelativeRoot.startsWith("collect/")) {
      throw new Error(`${brandId}: asset root must stay under collect/: ${repoRelativeRoot}`);
    }
    const repoRelativePath = portableRelativePath(
      assetRef.repo_relative_normalized_path,
      `${brandId}.asset_ref.repo_relative_normalized_path`,
    );
    const resolvedRoot = containedPath(repoRoot, repoRelativeRoot, `${assetRootId}.repo_relative_root`);
    const absolutePath = containedPath(repoRoot, repoRelativePath, `${brandId}.asset_ref.repo_relative_normalized_path`);
    if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`${brandId}: Logo asset is outside its catalog-whitelisted root`);
    }
    if (!repoRelativePath.split("/").includes("output") || path.posix.extname(repoRelativePath).toLowerCase() !== ".png") {
      throw new Error(`${brandId}: normalized Logo must be a PNG inside an output directory`);
    }
    return {
      brand_id: brandId,
      asset_root_id: assetRootId,
      asset_scope: assetScope,
      repo_relative_root: repoRelativeRoot,
      repo_relative_path: repoRelativePath,
      resolved_root: resolvedRoot,
      absolute_path: absolutePath,
      legacy: false,
      ...normalizedAssetMetadata(record),
    };
  }

  const legacyRelativePath = text(record?.normalized?.file);
  if (!legacyRelativePath) return null;
  if (!legacyAssetRoot) throw new Error(`${brandId}: legacyAssetRoot is required for catalog v3 assets`);
  const relativePath = portableRelativePath(legacyRelativePath, `${brandId}.normalized.file`);
  if (!relativePath.split("/").includes("output") || path.posix.extname(relativePath).toLowerCase() !== ".png") {
    throw new Error(`${brandId}: legacy normalized Logo must be a PNG inside an output directory`);
  }
  const resolvedRoot = path.resolve(legacyAssetRoot);
  const absolutePath = containedPath(resolvedRoot, relativePath, `${brandId}.normalized.file`);
  const relativeToRepo = repoRoot ? path.relative(path.resolve(repoRoot), absolutePath).split(path.sep).join("/") : null;
  return {
    brand_id: brandId,
    asset_root_id: "legacy_v3",
    asset_scope: record.approved_for_product === true ? "product_release" : "internal_preview",
    repo_relative_root: repoRoot ? path.relative(path.resolve(repoRoot), resolvedRoot).split(path.sep).join("/") : null,
    repo_relative_path: relativeToRepo && !relativeToRepo.startsWith("../") ? relativeToRepo : null,
    source_relative_path: relativePath,
    resolved_root: resolvedRoot,
    absolute_path: absolutePath,
    legacy: true,
    ...normalizedAssetMetadata(record),
  };
}

export function brandLogoAssetMap(catalog = {}, {
  repoRoot,
  legacyAssetRoot,
  requireProductApproval = false,
} = {}) {
  const result = new Map();
  for (const record of catalog.brands || []) {
    const brandId = text(record?.canonical_brand_id);
    if (!brandId || record.permission_status === "express_permission_required") continue;
    const releaseBlocked = RELEASE_BLOCKED_PERMISSION_STATUSES.has(record.permission_status);
    if (requireProductApproval && (record.approved_for_product !== true || releaseBlocked)) continue;
    const asset = resolveBrandLogoAsset(catalog, record, { repoRoot, legacyAssetRoot });
    if (!asset) continue;
    if (requireProductApproval && asset.asset_scope !== "product_release") continue;
    result.set(brandId, {
      ...asset,
      permission_status: text(record.permission_status) || "not_reviewed",
      approved_for_product: record.approved_for_product === true,
      usage_scope: requireProductApproval ? "product_release" : "internal_preview",
    });
  }
  return result;
}
