import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const result = { files: [], output: null, dryRun: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--file") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --file");
      result.files.push(path.resolve(process.cwd(), value));
      index += 1;
    } else if (item === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --output");
      result.output = path.resolve(process.cwd(), value);
      index += 1;
    } else if (item === "--dry-run") result.dryRun = true;
    else if (item === "--self-test") result.selfTest = true;
    else if (item === "--help" || item === "-h") {
      console.log("Usage: node collect/link-canonical-masters.mjs --file records.json [--file records.json] --output linked.json [--dry-run] [--self-test]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${item}`);
  }
  if (!result.selfTest && (!result.files.length || !result.output)) throw new Error("At least one --file and --output are required");
  return result;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.campaigns || [];
}

function sourceKey(record) {
  return `${record.source_site}:${record.source_record_id}`;
}

function assetKey(record, asset) {
  return `${sourceKey(record)}:${asset.asset_id}`;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeAspectRatio(asset) {
  if (asset.aspect_ratio) return String(asset.aspect_ratio);
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (!(width > 0 && height > 0)) return null;
  return (width / height).toFixed(3);
}

function fingerprintHashes(asset) {
  const fingerprint = asset.visual_fingerprint;
  if (fingerprint?.algorithm !== "dhash-9x8-v1") return null;
  if (!Array.isArray(fingerprint.frame_hashes) || fingerprint.frame_hashes.length !== 10) return null;
  if (fingerprint.frame_hashes.some((hash) => !/^[a-f0-9]{16}$/i.test(hash))) return null;
  return fingerprint.frame_hashes.map((hash) => hash.toLowerCase());
}

function stableProviderIdentity(asset) {
  if (!["youtube", "vimeo"].includes(asset.provider)) return null;
  const identifier = asset.source_asset_id || asset.asset_id;
  return identifier ? `${asset.provider}:${identifier}` : null;
}

function exactIdentity(record, asset) {
  if (/^[a-f0-9]{64}$/i.test(asset.content_sha256 || "")) return `sha256:${asset.content_sha256.toLowerCase()}`;
  const providerIdentity = stableProviderIdentity(asset);
  if (providerIdentity) return providerIdentity;
  const hashes = fingerprintHashes(asset);
  const duration = Number(asset.duration_seconds);
  const aspect = normalizeAspectRatio(asset);
  const brand = normalizeText(record.primary_brand);
  if (hashes && Number.isFinite(duration) && aspect && brand) {
    return `visual-exact:${brand}:${duration.toFixed(2)}:${aspect}:${hashes.join(":")}`;
  }
  return null;
}

function hashId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function bitCount(value) {
  let current = value;
  let count = 0;
  while (current) {
    count += Number(current & 1n);
    current >>= 1n;
  }
  return count;
}

function fingerprintDistance(leftAsset, rightAsset) {
  const left = fingerprintHashes(leftAsset);
  const right = fingerprintHashes(rightAsset);
  if (!left || !right) return null;
  const distances = left.map((hash, index) => bitCount(BigInt(`0x${hash}`) ^ BigInt(`0x${right[index]}`)));
  return {
    average: Number((distances.reduce((total, value) => total + value, 0) / distances.length).toFixed(2)),
    maximum: Math.max(...distances),
  };
}

function sourceRefFor(record, asset, relation) {
  return {
    source_site: record.source_site,
    source_record_id: record.source_record_id,
    source_detail_url: record.source_detail_url,
    source_asset_id: asset.source_asset_id || asset.asset_id,
    relation,
    collected_at: record.collected_at,
  };
}

function mergeRefs(existing, additions) {
  const refs = new Map();
  for (const ref of [...(existing || []), ...additions]) {
    const key = `${ref.source_site}:${ref.source_record_id}:${ref.source_asset_id || ""}`;
    const previous = refs.get(key);
    if (!previous || ref.relation === "primary") refs.set(key, ref);
  }
  return [...refs.values()].sort((left, right) =>
    `${left.source_site}:${left.source_record_id}:${left.source_asset_id || ""}`
      .localeCompare(`${right.source_site}:${right.source_record_id}:${right.source_asset_id || ""}`),
  );
}

function linkRecords(inputRecords) {
  const records = structuredClone(inputRecords);
  const duplicateSourceRecords = [];
  const recordIndex = new Map();
  for (const record of records) {
    const key = sourceKey(record);
    if (recordIndex.has(key)) duplicateSourceRecords.push(key);
    else recordIndex.set(key, record);
  }
  if (duplicateSourceRecords.length) {
    return { ok: false, records, errors: [...new Set(duplicateSourceRecords)].map((key) => `DUPLICATE_SOURCE_RECORD:${key}`) };
  }

  const entries = records.flatMap((record) =>
    (record.media_assets || [])
      .filter((asset) => asset.media_type === "video")
      .map((asset) => ({ record, asset, key: assetKey(record, asset), identity: exactIdentity(record, asset) })),
  );
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.identity || `unique:${entry.key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  let exactGroups = 0;
  let crossSiteGroups = 0;
  for (const [identity, members] of groups) {
    const existingIds = [...new Set(members.map(({ asset }) => asset.canonical_master_id).filter(Boolean))].sort();
    const canonicalMasterId = existingIds[0] || `master:${hashId(identity)}`;
    const groupSites = new Set(members.map(({ record }) => record.source_site));
    if (members.length > 1) exactGroups += 1;
    if (groupSites.size > 1) crossSiteGroups += 1;
    const allRefs = members.map(({ record, asset }) => sourceRefFor(record, asset, "same_master"));
    for (const member of members) {
      member.asset.canonical_master_id = canonicalMasterId;
      member.asset.canonical_match = {
        status: members.length > 1 ? "exact_match" : "unique",
        confidence: members.length > 1 ? 1 : null,
        evidence: entryEvidence(identity, members.length),
      };
      const additions = allRefs.map((ref) => ({
        ...ref,
        relation: ref.source_site === member.record.source_site
          && ref.source_record_id === member.record.source_record_id
          && ref.source_asset_id === (member.asset.source_asset_id || member.asset.asset_id)
          ? "primary"
          : "same_master",
      }));
      member.record.source_refs = mergeRefs(member.record.source_refs, additions);
    }
  }

  for (const record of records) {
    const videoAssets = (record.media_assets || []).filter((asset) => asset.media_type === "video");
    record.canonical_master_id = videoAssets.length === 1 ? videoAssets[0].canonical_master_id : null;
  }

  let alternateCutLinks = 0;
  let alternateAspectLinks = 0;
  let pendingSameMasterLinks = 0;
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (left.record.source_site === right.record.source_site) continue;
      if (left.asset.canonical_master_id === right.asset.canonical_master_id) continue;
      if (normalizeText(left.record.primary_brand) !== normalizeText(right.record.primary_brand)) continue;
      const distance = fingerprintDistance(left.asset, right.asset);
      if (!distance || distance.average > 6 || distance.maximum > 16) continue;
      const leftDuration = Number(left.asset.duration_seconds);
      const rightDuration = Number(right.asset.duration_seconds);
      const durationDifference = Number.isFinite(leftDuration) && Number.isFinite(rightDuration)
        ? Math.abs(leftDuration - rightDuration)
        : null;
      const sameAspect = normalizeAspectRatio(left.asset) === normalizeAspectRatio(right.asset);
      let relation = "pending_canonical_review";
      if (!sameAspect) {
        relation = "alternate_aspect_ratio";
        alternateAspectLinks += 1;
      } else if (durationDifference != null && durationDifference > 0.35) {
        relation = "alternate_cut";
        alternateCutLinks += 1;
      } else {
        pendingSameMasterLinks += 1;
      }
      addRelation(left.asset, right.asset, relation, distance, durationDifference);
      addRelation(right.asset, left.asset, relation, distance, durationDifference);
    }
  }

  return {
    ok: true,
    records,
    errors: [],
    summary: {
      records: records.length,
      video_assets: entries.length,
      canonical_masters: new Set(entries.map(({ asset }) => asset.canonical_master_id)).size,
      exact_match_groups: exactGroups,
      cross_site_exact_match_groups: crossSiteGroups,
      alternate_cut_links: alternateCutLinks,
      alternate_aspect_ratio_links: alternateAspectLinks,
      pending_same_master_review_links: pendingSameMasterLinks,
    },
  };
}

function entryEvidence(identity, memberCount) {
  if (memberCount === 1) return ["No strong duplicate evidence in the supplied batch; unique canonical ID assigned."];
  if (identity.startsWith("sha256:")) return ["Temporary media files have identical SHA-256 content hashes."];
  if (identity.startsWith("youtube:") || identity.startsWith("vimeo:")) return ["Stable provider and source asset IDs are identical."];
  if (identity.startsWith("visual-exact:")) return ["Brand, duration, aspect ratio and all 10 dHash frame fingerprints are identical."];
  return ["Exact media identity matched."];
}

function addRelation(asset, target, relation, distance, durationDifference) {
  const value = {
    canonical_master_id: target.canonical_master_id,
    relation,
    confidence: relation === "pending_canonical_review" ? 0.9 : 0.86,
    evidence: [
      `Aligned 10-frame dHash average distance ${distance.average}, maximum ${distance.maximum}.`,
      durationDifference == null ? "Duration comparison unavailable." : `Duration difference ${durationDifference.toFixed(3)} seconds.`,
      `Aspect ratios: ${normalizeAspectRatio(asset) || "unknown"} vs ${normalizeAspectRatio(target) || "unknown"}.`,
    ],
  };
  const existing = (asset.master_relations || []).filter((item) =>
    !(item.canonical_master_id === value.canonical_master_id && item.relation === value.relation),
  );
  asset.master_relations = [...existing, value].sort((left, right) =>
    `${left.relation}:${left.canonical_master_id}`.localeCompare(`${right.relation}:${right.canonical_master_id}`),
  );
}

function fixtureRecord(sourceSite, sourceRecordId, assetId, overrides = {}) {
  const frameHashes = Array(10).fill("0123456789abcdef");
  return {
    source_site: sourceSite,
    source_record_id: sourceRecordId,
    source_detail_url: `https://example.com/${sourceRecordId}`,
    primary_brand: "Example Brand",
    collected_at: "2026-08-20T00:00:00.000Z",
    canonical_master_id: null,
    source_refs: [],
    media_assets: [{
      asset_id: assetId,
      source_asset_id: assetId,
      media_type: "video",
      provider: "mp4",
      duration_seconds: 30,
      width: 1280,
      height: 720,
      aspect_ratio: "16:9",
      content_sha256: null,
      visual_fingerprint: { algorithm: "dhash-9x8-v1", frame_hashes: frameHashes },
      ...overrides,
    }],
  };
}

function selfTest() {
  const sharedSha = "a".repeat(64);
  const records = [
    fixtureRecord("best_ads", "same-best", "best-video", { content_sha256: sharedSha }),
    fixtureRecord("ads_of_the_world", "same-aotw", "aotw-video", { content_sha256: sharedSha }),
    fixtureRecord("ads_of_the_world", "alternate-cut", "cut-video", { content_sha256: "b".repeat(64), duration_seconds: 15 }),
    fixtureRecord("ads_of_the_world", "alternate-aspect", "vertical-video", { content_sha256: "c".repeat(64), width: 720, height: 1280, aspect_ratio: "9:16" }),
  ];
  const linked = linkRecords(records);
  const assets = linked.records.map((record) => record.media_assets[0]);
  const sameMaster = assets[0].canonical_master_id === assets[1].canonical_master_id;
  const mergedRefs = linked.records[0].source_refs.length === 2 && linked.records[1].source_refs.length === 2;
  const cutSeparate = assets[0].canonical_master_id !== assets[2].canonical_master_id
    && assets[0].master_relations.some((item) => item.relation === "alternate_cut" && item.canonical_master_id === assets[2].canonical_master_id);
  const aspectSeparate = assets[0].canonical_master_id !== assets[3].canonical_master_id
    && assets[0].master_relations.some((item) => item.relation === "alternate_aspect_ratio" && item.canonical_master_id === assets[3].canonical_master_id);
  const ok = linked.ok && sameMaster && mergedRefs && cutSeparate && aspectSeparate;
  return {
    ok,
    red_to_green: {
      red: { ok: false, canonical_master_ids: [null, null], source_refs_per_record: [0, 0], alternate_links: 0 },
      green: {
        ok,
        same_master_merged: sameMaster,
        source_refs_merged: mergedRefs,
        alternate_cut_separate_and_linked: cutSeparate,
        alternate_aspect_separate_and_linked: aspectSeparate,
        summary: linked.summary,
      },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const result = selfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  const payloads = await Promise.all(args.files.map((file) => fs.readFile(file, "utf8").then(JSON.parse)));
  const records = payloads.flatMap(recordsFrom);
  const result = linkRecords(records);
  const summary = {
    ok: result.ok,
    dry_run: args.dryRun,
    inputs: args.files.map((file) => path.relative(process.cwd(), file)),
    ...result.summary,
    errors: result.errors,
  };
  if (!args.dryRun && result.ok) {
    const generatedAt = records.map((record) => record.collected_at).filter(Boolean).sort().at(-1) || null;
    const output = {
      version: 1,
      generated_at: generatedAt,
      source_site: "combined",
      source_files: summary.inputs,
      records: result.records,
      canonical_link_report: result.summary,
    };
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

await main();
