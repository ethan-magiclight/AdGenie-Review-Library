import fs from "node:fs/promises";
import path from "node:path";

const mutableAssetFields = new Set([
  "duration_seconds",
  "width",
  "height",
  "aspect_ratio",
  "access_status",
  "checked_at",
  "contact_sheet_path",
  "contact_sheet_status",
  "failure_reason",
  "content_sha256",
  "visual_fingerprint",
]);

function parseArgs(argv) {
  const result = { records: null, manifests: [], output: null, dryRun: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${item}`);
      index += 1;
      return path.resolve(process.cwd(), value);
    };
    if (item === "--records") result.records = next();
    else if (item === "--manifest") result.manifests.push(next());
    else if (item === "--output") result.output = next();
    else if (item === "--dry-run") result.dryRun = true;
    else if (item === "--self-test") result.selfTest = true;
    else if (item === "--help" || item === "-h") {
      console.log("Usage: node collect/apply-media-manifest.mjs --records records.json --manifest manifest.json [--manifest manifest.json] --output enriched.json [--dry-run] [--self-test]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${item}`);
  }
  if (!result.selfTest && (!result.records || !result.manifests.length || !result.output)) {
    throw new Error("--records, at least one --manifest, and --output are required");
  }
  return result;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.campaigns || [];
}

function manifestRecordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.items || [];
}

function keyFor(value) {
  return `${value.source_site}:${value.source_record_id}:${value.asset_id}`;
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function greatestCommonDivisor(left, right) {
  let first = Math.abs(left);
  let second = Math.abs(right);
  while (second) [first, second] = [second, first % second];
  return first || 1;
}

function aspectRatio(width, height) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function errorAccessStatus(error) {
  const value = String(error || "").toLowerCase();
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden/.test(value)) return "forbidden";
  if (/\b404\b|not found/.test(value)) return "not_found";
  return "error";
}

function validateManifestRecord(item) {
  const errors = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) return ["MANIFEST_RECORD_OBJECT_REQUIRED"];
  for (const field of ["source_site", "source_record_id", "asset_id", "provider", "status"]) {
    if (!String(item[field] || "").trim()) errors.push(`MANIFEST_FIELD_REQUIRED:${field}`);
  }
  if (!['ok', 'error'].includes(item.status)) errors.push("MANIFEST_STATUS_INVALID");
  if ((item.temporary_video_cleanup?.remaining || []).length) errors.push("TEMPORARY_VIDEO_RESIDUE_FORBIDDEN");
  if (item.status === "ok") {
    if (!isPositiveNumber(item.duration_seconds)) errors.push("MEDIA_DURATION_REQUIRED");
    if (!Number.isInteger(item.width) || item.width < 1) errors.push("MEDIA_WIDTH_REQUIRED");
    if (!Number.isInteger(item.height) || item.height < 1) errors.push("MEDIA_HEIGHT_REQUIRED");
    if (!String(item.contact_sheet || "").trim()) errors.push("CONTACT_SHEET_PATH_REQUIRED");
    if (item.sheet_validation?.frame_count !== 10) errors.push("CONTACT_SHEET_EXACTLY_10_FRAMES_REQUIRED");
    if (!Number.isInteger(item.sheet_validation?.width) || item.sheet_validation.width < 1) errors.push("CONTACT_SHEET_WIDTH_REQUIRED");
    if (!Number.isInteger(item.sheet_validation?.height) || item.sheet_validation.height < 1) errors.push("CONTACT_SHEET_HEIGHT_REQUIRED");
    if (item.error) errors.push("SUCCESS_MANIFEST_CANNOT_HAVE_ERROR");
    if (item.content_sha256 != null && !/^[a-f0-9]{64}$/i.test(item.content_sha256)) errors.push("CONTENT_SHA256_INVALID");
    if (item.visual_fingerprint != null) {
      if (item.visual_fingerprint.algorithm !== "dhash-9x8-v1") errors.push("VISUAL_FINGERPRINT_ALGORITHM_INVALID");
      const hashes = item.visual_fingerprint.frame_hashes;
      if (!Array.isArray(hashes) || hashes.length !== 10 || hashes.some((hash) => !/^[a-f0-9]{16}$/i.test(hash))) {
        errors.push("VISUAL_FINGERPRINT_10_HASHES_REQUIRED");
      }
    }
  } else if (!String(item.error || "").trim()) {
    errors.push("FAILED_MEDIA_REASON_REQUIRED");
  }
  return [...new Set(errors)];
}

function validManifestRecord() {
  return {
    source_site: "ads_of_the_world",
    source_record_id: "fixture",
    asset_id: "fixture-video",
    provider: "aotw_cdn",
    status: "ok",
    error: null,
    duration_seconds: 30,
    width: 1280,
    height: 720,
    contact_sheet: "/tmp/contact-sheet.jpg",
    sheet_validation: { width: 1612, height: 366, frame_count: 10 },
    temporary_video_cleanup: { removed: ["/tmp/video.mp4"], remaining: [] },
    content_sha256: "a".repeat(64),
    visual_fingerprint: { algorithm: "dhash-9x8-v1", frame_hashes: Array(10).fill("0123456789abcdef") },
  };
}

function selfTest() {
  const tests = [];
  for (const [name, mutate, expected] of [
    ["nine_frames", (item) => { item.sheet_validation.frame_count = 9; }, "CONTACT_SHEET_EXACTLY_10_FRAMES_REQUIRED"],
    ["missing_contact_sheet", (item) => { item.contact_sheet = null; }, "CONTACT_SHEET_PATH_REQUIRED"],
    ["temporary_video_residue", (item) => { item.temporary_video_cleanup.remaining = ["/tmp/video.mp4"]; }, "TEMPORARY_VIDEO_RESIDUE_FORBIDDEN"],
    ["failed_without_reason", (item) => { item.status = "error"; item.error = null; }, "FAILED_MEDIA_REASON_REQUIRED"],
    ["invalid_fingerprint", (item) => { item.content_sha256 = "not-a-sha"; item.visual_fingerprint.frame_hashes.pop(); }, "CONTENT_SHA256_INVALID"],
  ]) {
    const redItem = structuredClone(validManifestRecord());
    mutate(redItem);
    const red = validateManifestRecord(redItem);
    const green = validateManifestRecord(validManifestRecord());
    tests.push({
      case: name,
      red: { ok: red.length === 0, errors: red },
      green: { ok: green.length === 0, errors: green },
      passed: red.includes(expected) && green.length === 0,
    });
  }
  return { ok: tests.every((test) => test.passed), red_to_green: tests };
}

function stableRecordFields(record) {
  return JSON.stringify({
    source_site: record.source_site,
    source_record_id: record.source_record_id,
    source_detail_url: record.source_detail_url,
    primary_brand: record.primary_brand,
    brands: record.brands,
    campaign_published_at: record.campaign_published_at,
    source_uploaded_at: record.source_uploaded_at,
    publish_date_source: record.publish_date_source,
    publish_date_confidence: record.publish_date_confidence,
    campaign_year_status: record.campaign_year_status,
    classification_candidate: record.classification_candidate,
    review_status: record.review_status,
    approved: record.approved,
    core_template_eligible: record.core_template_eligible,
    genres: record.genres,
  });
}

function unchangedAssetFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (mutableAssetFields.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return false;
  }
  return true;
}

function relativeOutputPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") ? filePath : relative.split(path.sep).join("/");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const summary = selfTest();
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exit(1);
    return;
  }

  const recordPayload = JSON.parse(await fs.readFile(args.records, "utf8"));
  const records = recordsFrom(recordPayload);
  const protectedBefore = new Map(records.map((record) => [
    `${record.source_site}:${record.source_record_id}`,
    stableRecordFields(record),
  ]));
  const assetIndex = new Map();
  for (const record of records) {
    for (const asset of record.media_assets || []) {
      assetIndex.set(keyFor({ ...record, asset_id: asset.asset_id }), { record, asset });
    }
  }

  const manifestEntries = [];
  const manifestTimestamps = [];
  for (const manifestPath of args.manifests) {
    const [payload, stat] = await Promise.all([
      fs.readFile(manifestPath, "utf8").then(JSON.parse),
      fs.stat(manifestPath),
    ]);
    const checkedAt = stat.mtime.toISOString();
    manifestTimestamps.push(checkedAt);
    for (const item of manifestRecordsFrom(payload)) {
      manifestEntries.push({ item, checkedAt, manifestPath });
    }
  }

  const errors = [];
  const seenManifestKeys = new Set();
  let applied = 0;
  let available = 0;
  let temporary = 0;
  let failed = 0;
  for (const entry of manifestEntries) {
    const { item, checkedAt, manifestPath } = entry;
    const key = keyFor(item || {});
    const itemErrors = validateManifestRecord(item);
    if (seenManifestKeys.has(key)) itemErrors.push("DUPLICATE_MANIFEST_ASSET");
    seenManifestKeys.add(key);
    const target = assetIndex.get(key);
    if (!target) itemErrors.push("SOURCE_MEDIA_ASSET_NOT_FOUND");
    if (target && target.asset.provider !== item.provider) itemErrors.push("MEDIA_PROVIDER_MISMATCH");
    if (target && item.source_detail_url && target.record.source_detail_url !== item.source_detail_url) itemErrors.push("SOURCE_DETAIL_URL_MISMATCH");
    if (item.status === "ok" && item.contact_sheet) {
      try {
        const sheetStat = await fs.stat(path.resolve(item.contact_sheet));
        if (!sheetStat.isFile() || sheetStat.size < 1) itemErrors.push("CONTACT_SHEET_FILE_INVALID");
      } catch {
        itemErrors.push("CONTACT_SHEET_FILE_NOT_FOUND");
      }
    }
    if (itemErrors.length) {
      errors.push({ key, manifest: relativeOutputPath(manifestPath), errors: [...new Set(itemErrors)] });
      continue;
    }

    const beforeAsset = structuredClone(target.asset);
    if (item.status === "ok") {
      target.asset.duration_seconds = item.duration_seconds;
      target.asset.width = item.width;
      target.asset.height = item.height;
      target.asset.aspect_ratio = aspectRatio(item.width, item.height);
      target.asset.access_status = target.asset.locator_is_temporary ? "temporary" : "available";
      target.asset.checked_at = checkedAt;
      target.asset.contact_sheet_path = relativeOutputPath(path.resolve(item.contact_sheet));
      target.asset.contact_sheet_status = "available";
      target.asset.failure_reason = null;
      if (item.content_sha256) target.asset.content_sha256 = item.content_sha256;
      if (item.visual_fingerprint) target.asset.visual_fingerprint = item.visual_fingerprint;
      if (target.asset.locator_is_temporary) temporary += 1;
      else available += 1;
    } else {
      target.asset.access_status = errorAccessStatus(item.error);
      target.asset.checked_at = checkedAt;
      target.asset.contact_sheet_path = null;
      target.asset.contact_sheet_status = "failed";
      target.asset.failure_reason = item.error;
      failed += 1;
    }
    if (!unchangedAssetFields(beforeAsset, target.asset)) {
      errors.push({ key, manifest: relativeOutputPath(manifestPath), errors: ["NON_MEDIA_ASSET_FIELD_MUTATED"] });
      continue;
    }
    applied += 1;
  }

  let protectedRecordMutations = 0;
  for (const record of records) {
    const key = `${record.source_site}:${record.source_record_id}`;
    if (protectedBefore.get(key) !== stableRecordFields(record)) {
      protectedRecordMutations += 1;
      errors.push({ key, errors: ["PROTECTED_RECORD_FIELD_MUTATED"] });
    }
  }

  const summary = {
    ok: errors.length === 0,
    dry_run: args.dryRun,
    records: records.length,
    manifest_records: manifestEntries.length,
    applied,
    available,
    temporary,
    failed,
    protected_record_mutations: protectedRecordMutations,
    errors,
  };
  if (!args.dryRun && summary.ok) {
    const output = {
      ...recordPayload,
      records,
      media_manifest_applied_at: manifestTimestamps.sort().at(-1),
      media_manifest_sources: args.manifests.map(relativeOutputPath),
    };
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

await main();
