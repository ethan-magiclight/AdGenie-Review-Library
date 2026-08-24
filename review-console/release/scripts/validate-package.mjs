import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPackageRoot = path.basename(path.dirname(scriptDir)) === "review-console"
  ? path.join(path.dirname(scriptDir), "release")
  : path.dirname(scriptDir);
const packageRootArgumentIndex = process.argv.indexOf("--package-root");
const packageRoot = packageRootArgumentIndex >= 0
  ? path.resolve(process.argv[packageRootArgumentIndex + 1])
  : defaultPackageRoot;
const statePath = path.join(packageRoot, "web/data/creative-library-state.json");
const manifestPath = path.join(packageRoot, "manifest.json");
const checksumManifestPath = "checksums.sha256";
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const portableTextExtensions = new Set([".json", ".md", ".mjs", ".js", ".css", ".html", ".txt"]);
const formalSourceIds = new Set(["ads_of_the_world", "best_ads", "stash"]);
const releaseBlockedPermissionStatuses = new Set(["express_permission_required", "identity_and_legal_review_required"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function remoteVideoReference(video) {
  return [video.playback_url, video.original_media_url, video.embed_url, video.url]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
}

function safeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty path`);
  assert(!value.includes("\\") && !value.includes("\0") && !path.posix.isAbsolute(value), `${label} must be package-relative: ${value}`);
  const normalized = path.posix.normalize(value);
  assert(normalized === value && !normalized.split("/").some((segment) => !segment || segment === "." || segment === ".."), `${label} escapes package root: ${value}`);
  return normalized;
}

function sourceId(video) {
  return String(video?.source_site || video?.source_platform || "unknown").trim().toLocaleLowerCase("en-US");
}

function videoId(video) {
  return String(video?.video_id || video?.id || "").trim();
}

function countBy(items, valueForItem) {
  const result = {};
  for (const item of items) {
    const key = String(valueForItem(item) || "unknown");
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function pngDimensions(buffer) {
  assert(buffer.length >= 24 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && buffer.subarray(12, 16).toString("ascii") === "IHDR", "Packaged Logo is not a valid PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function sha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function walkFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function validateChecksums(manifest, packagedRelativeFiles) {
  assert(Number(manifest.version || 0) >= 4, "Package manifest version does not declare complete checksums");
  const contract = manifest.package?.checksum_manifest;
  assert(contract?.path === checksumManifestPath, "Package checksum manifest path is invalid");
  assert(contract.algorithm === "sha256", "Package checksum algorithm is invalid");
  assert(contract.scope === "all_regular_files_except_checksum_manifest", "Package checksum scope is invalid");

  const checksumBody = await fs.readFile(path.join(packageRoot, checksumManifestPath), "utf8");
  assert(checksumBody.endsWith("\n"), "Package checksum manifest must end with a newline");
  const entries = checksumBody.slice(0, -1).split("\n").map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert(match, `Invalid package checksum line: ${line}`);
    const relativePath = safeRelativePath(match[2], "package checksum path");
    assert(relativePath !== checksumManifestPath, "Package checksum manifest cannot include itself");
    return { sha256: match[1], path: relativePath };
  });
  const declaredPaths = entries.map((entry) => entry.path);
  assert(new Set(declaredPaths).size === declaredPaths.length, "Package checksum manifest contains duplicate paths");
  assert(JSON.stringify(declaredPaths) === JSON.stringify([...declaredPaths].sort()), "Package checksum manifest paths are not sorted");

  const expectedPaths = packagedRelativeFiles.filter((relativePath) => relativePath !== checksumManifestPath).sort();
  assert(JSON.stringify(declaredPaths) === JSON.stringify(expectedPaths), "Package checksum manifest does not cover the exact package file set");
  assert(contract.files === entries.length, "Package checksum file count does not match manifest");
  for (const entry of entries) {
    assert(await sha256(path.join(packageRoot, entry.path)) === entry.sha256, `Package checksum mismatch: ${entry.path}`);
  }
  return entries.length;
}

const stateContent = await fs.readFile(statePath);
const state = JSON.parse(stateContent);
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const stateHash = crypto.createHash("sha256").update(stateContent).digest("hex");

assert(stateHash === manifest.state_sha256, "Packaged state hash does not match manifest");
assert(state.videos.length === manifest.counts.videos, "Video count does not match manifest");
assert((state.review_events?.length || 0) === manifest.counts.review_events, "Review event count does not match manifest");

const missingLinks = state.videos.filter((video) => !remoteVideoReference(video));
assert(missingLinks.length === 0, `Videos without remote links: ${missingLinks.length}`);

const [{ brandLogoAssetMap }, { publicMediaFields }] = await Promise.all([
  import(pathToFileURL(path.join(packageRoot, "web/lib/brand-governance.mjs")).href),
  import(pathToFileURL(path.join(packageRoot, "web/lib/media-resolver.mjs")).href),
]);
const formalVideos = state.videos.filter((video) => formalSourceIds.has(sourceId(video)));
const formalErrors = [];
for (const video of formalVideos) {
  const id = videoId(video) || "unknown";
  if (!(typeof video.source_detail_url === "string" && /^https?:\/\//i.test(video.source_detail_url))) formalErrors.push(`${id}: source_detail_url`);
  if (!remoteVideoReference(video)) formalErrors.push(`${id}: remote_media_locator`);
  if (!String(video.media_access_status || "").trim()) formalErrors.push(`${id}: media_access_status`);
  if (!(typeof video.contact_sheet === "string" && video.contact_sheet.startsWith("/media/collect/"))) formalErrors.push(`${id}: contact_sheet`);
  const mediaFields = publicMediaFields(video);
  if (mediaFields.media_playback_url !== `/api/videos/${encodeURIComponent(id)}/media`) formalErrors.push(`${id}: media_playback_url`);
  if (mediaFields.media_download_url !== `/api/videos/${encodeURIComponent(id)}/media/download`) formalErrors.push(`${id}: media_download_url`);
}
assert(formalErrors.length === 0, `Formal three-source delivery fields are incomplete: ${formalErrors.slice(0, 20).join(", ")}`);
assert(formalVideos.length === manifest.counts.formal_three_source_videos, "Formal three-source video count does not match manifest");
assert(JSON.stringify(countBy(formalVideos, sourceId)) === JSON.stringify(manifest.formal_three_sources?.by_source), "Formal source counts do not match manifest");
const mediaAccessBySource = Object.fromEntries([...formalSourceIds].sort().map((source) => [
  source,
  countBy(formalVideos.filter((video) => sourceId(video) === source), (video) => video.media_access_status),
]));
assert(JSON.stringify(mediaAccessBySource) === JSON.stringify(manifest.formal_three_sources?.media_access_status_by_source), "Formal media access status counts do not match manifest");
const mediaDownloadCapabilities = countBy(formalVideos, (video) => publicMediaFields(video).media_download_capability);
assert(JSON.stringify(mediaDownloadCapabilities) === JSON.stringify(manifest.formal_three_sources?.media_api_contract?.download_capability_by_provider), "Formal media download capability counts do not match manifest");
assert(manifest.formal_three_sources?.media_api_contract?.download_semantics?.runtime_progressive_or_hls, "Manifest is missing runtime Vimeo download semantics");
for (const key of [
  "formal_source_detail_urls",
  "formal_remote_media_locators",
  "formal_media_access_statuses",
  "formal_contact_sheets",
  "formal_media_playback_api_fields",
  "formal_media_download_api_fields",
]) {
  assert(manifest.counts[key] === formalVideos.length, `${key} does not cover all formal three-source videos`);
}

const missingSourceFiles = [];
for (const relativePath of manifest.source_files) {
  try {
    await fs.access(path.join(packageRoot, relativePath));
  } catch {
    missingSourceFiles.push(relativePath);
  }
}
assert(missingSourceFiles.length === 0, `Missing source files: ${missingSourceFiles.join(", ")}`);
const sourceEvidenceFiles = manifest.source_evidence?.files || [];
const portabilityPolicy = manifest.source_evidence?.portability_policy;
assert(portabilityPolicy?.mode === "absolute_user_paths_replaced_in_packaged_text_evidence", "Source evidence portability policy is missing");
assert(portabilityPolicy.original_evidence_unchanged === true, "Source evidence portability policy must preserve originals");
assert(Array.isArray(portabilityPolicy.replacement_tokens) && portabilityPolicy.replacement_tokens.length > 0, "Source evidence portability tokens are missing");
assert(sourceEvidenceFiles.length === manifest.counts.source_files, "Source evidence artifact count does not match manifest");
assert(sourceEvidenceFiles.filter((artifact) => artifact.source_scope === "external_allowlisted").length === manifest.counts.external_source_files, "External source evidence count does not match manifest");
assert(JSON.stringify(sourceEvidenceFiles.map((artifact) => artifact.packaged_path).sort()) === JSON.stringify([...manifest.source_files].sort()), "Source evidence package paths do not match manifest.source_files");
for (const artifact of sourceEvidenceFiles) {
  const relativePath = safeRelativePath(artifact.packaged_path, "source evidence");
  assert(relativePath.startsWith("collect/"), `Source evidence is outside collect/: ${relativePath}`);
  assert(new Set(["repo", "external_allowlisted"]).has(artifact.source_scope), `Source evidence scope is invalid: ${relativePath}`);
  if (artifact.source_scope === "repo") {
    assert(artifact.original_path === relativePath && artifact.external_root_id === null, `Repo source evidence mapping is invalid: ${relativePath}`);
  } else {
    assert(relativePath.startsWith("collect/external-evidence/"), `External source evidence is outside its package namespace: ${relativePath}`);
    assert(typeof artifact.original_path === "string" && artifact.original_path.startsWith("../") && !artifact.original_path.includes("\\") && !path.posix.isAbsolute(artifact.original_path), `External source evidence original path is invalid: ${relativePath}`);
    assert(typeof artifact.external_root_id === "string" && artifact.external_root_id.length > 0, `External source evidence root id is missing: ${relativePath}`);
  }
  const body = await fs.readFile(path.join(packageRoot, relativePath));
  assert(body.length === artifact.bytes, `Source evidence byte count mismatch: ${relativePath}`);
  assert(crypto.createHash("sha256").update(body).digest("hex") === artifact.sha256, `Source evidence SHA-256 mismatch: ${relativePath}`);
  assert(/^[a-f0-9]{64}$/.test(artifact.source_sha256), `Source evidence original SHA-256 is missing: ${relativePath}`);
  assert(Number.isSafeInteger(artifact.source_bytes) && artifact.source_bytes >= 0, `Source evidence original byte count is missing: ${relativePath}`);
  assert(Number.isSafeInteger(artifact.portability_redactions) && artifact.portability_redactions >= 0, `Source evidence portability count is invalid: ${relativePath}`);
}
assert(sourceEvidenceFiles.reduce((sum, artifact) => sum + artifact.portability_redactions, 0) === portabilityPolicy.total_replacements, "Source evidence portability replacement count does not match manifest");

const missingContactSheets = [];
for (const relativePath of manifest.contact_sheets) {
  try {
    await fs.access(path.join(packageRoot, relativePath));
  } catch {
    missingContactSheets.push(relativePath);
  }
}
assert(missingContactSheets.length === 0, `Missing contact sheets: ${missingContactSheets.length}`);

const brandGovernance = manifest.brand_governance;
assert(brandGovernance && typeof brandGovernance === "object", "Manifest is missing brand_governance");
const requiredBrandSidecars = new Set([
  "collect/brand-normalization-map-v2.json",
  "collect/brand-logo-catalog-v4.json",
  "collect/brand-delivery-contract-v1.md",
  "collect/brand-identity-contract-v1.md",
  "collect/brand-logo-catalog-v4-contract.md",
  "collect/brand-logo-methodology-v3.md",
  "collect/runs/brand-governance-20260823/audit-report.json",
  "collect/runs/brand-governance-20260823/record-risks.json",
  "collect/runs/brand-logo-three-source-20260823/brand-assets/visual-review-gate.json",
]);
const sidecarByPath = new Map((brandGovernance.sidecars || []).map((artifact) => [artifact.path, artifact]));
for (const requiredPath of requiredBrandSidecars) assert(sidecarByPath.has(requiredPath), `Missing required brand sidecar declaration: ${requiredPath}`);
for (const artifact of brandGovernance.sidecars || []) {
  const relativePath = safeRelativePath(artifact.path, "brand sidecar");
  const absolutePath = path.join(packageRoot, relativePath);
  const body = await fs.readFile(absolutePath);
  assert(body.length === artifact.bytes, `Brand sidecar byte count mismatch: ${relativePath}`);
  assert(crypto.createHash("sha256").update(body).digest("hex") === artifact.sha256, `Brand sidecar SHA-256 mismatch: ${relativePath}`);
}

const brandCatalogPath = path.join(packageRoot, safeRelativePath(brandGovernance.catalog?.path, "brand catalog"));
assert(await sha256(brandCatalogPath) === brandGovernance.catalog.sha256, "Brand catalog SHA-256 does not match manifest");
const brandCatalog = JSON.parse(await fs.readFile(brandCatalogPath, "utf8"));
assert(Number(brandCatalog.version || 0) >= 4, "Packaged brand catalog must be v4 or newer");
const legacyAssetRoot = path.join(packageRoot, safeRelativePath(brandGovernance.legacy_asset_root, "legacy brand asset root"));
const previewLogoMap = brandLogoAssetMap(brandCatalog, { repoRoot: packageRoot, legacyAssetRoot });
const releaseLogoMap = brandLogoAssetMap(brandCatalog, { repoRoot: packageRoot, legacyAssetRoot, requireProductApproval: true });
const manifestPreviewByBrand = new Map((brandGovernance.preview_assets || []).map((asset) => [asset.brand_id, asset]));
const manifestReleaseByBrand = new Map((brandGovernance.release_assets || []).map((asset) => [asset.brand_id, asset]));
assert(previewLogoMap.size === manifest.counts.brand_preview_assets, "Brand preview asset count does not match manifest");
assert(releaseLogoMap.size === manifest.counts.brand_release_assets, "Brand release asset count does not match manifest");
assert(manifestPreviewByBrand.size === previewLogoMap.size, "Brand preview asset declarations are incomplete or duplicated");
assert(manifestReleaseByBrand.size === releaseLogoMap.size, "Brand release asset declarations are incomplete or duplicated");
for (const [brandId, expected] of previewLogoMap) {
  const declared = manifestPreviewByBrand.get(brandId);
  assert(declared, `${brandId}: preview Logo is missing from manifest`);
  const relativePath = safeRelativePath(declared.path, `${brandId} preview Logo`);
  assert(relativePath === expected.repo_relative_path, `${brandId}: preview Logo path differs from catalog`);
  const body = await fs.readFile(path.join(packageRoot, relativePath));
  const dimensions = pngDimensions(body);
  const actualSha256 = crypto.createHash("sha256").update(body).digest("hex");
  assert(dimensions.width === 224 && dimensions.height === 224, `${brandId}: preview Logo must be 224x224`);
  assert(actualSha256 === declared.sha256 && (!expected.sha256 || actualSha256 === expected.sha256), `${brandId}: preview Logo SHA-256 mismatch`);
  assert(body.length === declared.bytes && (expected.bytes === null || body.length === expected.bytes), `${brandId}: preview Logo byte count mismatch`);
  assert(expected.permission_status !== "express_permission_required", `${brandId}: permission-blocked Logo entered preview delivery`);
}
for (const [brandId, expected] of releaseLogoMap) {
  const declared = manifestReleaseByBrand.get(brandId);
  assert(declared, `${brandId}: release Logo is missing from manifest`);
  assert(expected.approved_for_product === true, `${brandId}: release Logo is not product-approved`);
  assert(!releaseBlockedPermissionStatuses.has(expected.permission_status), `${brandId}: release Logo has a blocked permission status`);
  assert(declared.path === manifestPreviewByBrand.get(brandId)?.path, `${brandId}: release Logo must resolve to the validated preview asset`);
}

const packagedFiles = await walkFiles(packageRoot);
const localVideos = packagedFiles.filter((filePath) => videoExtensions.has(path.extname(filePath).toLowerCase()));
assert(localVideos.length === 0, `Local video files are forbidden: ${localVideos.join(", ")}`);
const packagedRelativeFiles = packagedFiles.map((filePath) => path.relative(packageRoot, filePath).split(path.sep).join("/"));
const nonPortableTextFiles = [];
for (const filePath of packagedFiles) {
  if (!portableTextExtensions.has(path.extname(filePath).toLowerCase())) continue;
  const body = await fs.readFile(filePath, "utf8");
  if (/\/Users\/[^/\s"'<>]+\//.test(body)) nonPortableTextFiles.push(path.relative(packageRoot, filePath).split(path.sep).join("/"));
}
assert(nonPortableTextFiles.length === 0, `Package contains non-portable user paths: ${nonPortableTextFiles.join(", ")}`);
const checksumFiles = await validateChecksums(manifest, packagedRelativeFiles);
const previewPaths = new Set((brandGovernance.preview_assets || []).map((asset) => asset.path));
for (const root of Object.values(brandCatalog.asset_roots || {})) {
  const repoRelativeRoot = safeRelativePath(root.repo_relative_root, "brand asset root");
  const unexpectedPngs = packagedRelativeFiles.filter((filePath) => (
    filePath.startsWith(`${repoRelativeRoot}/`)
    && filePath.endsWith(".png")
    && !previewPaths.has(filePath)
  ));
  assert(unexpectedPngs.length === 0, `Rejected or undeclared Logo PNGs were packaged: ${unexpectedPngs.join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  package_root: packageRoot,
  videos: state.videos.length,
  review_events: state.review_events?.length || 0,
  source_files: manifest.source_files.length,
  external_source_files: manifest.counts.external_source_files,
  portability_redactions: portabilityPolicy.total_replacements,
  contact_sheets: manifest.contact_sheets.length,
  checksum_files: checksumFiles,
  remote_video_references: state.videos.length,
  local_video_files: localVideos.length,
  formal_three_sources: manifest.formal_three_sources.by_source,
  formal_media_access_status_by_source: manifest.formal_three_sources.media_access_status_by_source,
  brand_preview_assets: previewLogoMap.size,
  brand_release_assets: releaseLogoMap.size
}, null, 2));
