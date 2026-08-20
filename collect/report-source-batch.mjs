import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { records: null, checkpoint: null, contactSheets: null, output: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${item}`);
      index += 1;
      return path.resolve(process.cwd(), value);
    };
    if (item === "--records") args.records = next();
    else if (item === "--checkpoint") args.checkpoint = next();
    else if (item === "--contact-sheets") args.contactSheets = next();
    else if (item === "--output") args.output = next();
    else if (item === "--self-test") args.selfTest = true;
    else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!args.help && !args.selfTest && !args.records) throw new Error("--records is required");
  return args;
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function distribution(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) || 0) + 1), new Map())]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function duplicateCount(values) {
  return values.length - new Set(values).size;
}

function latestOutcomes(outcomes) {
  const latest = new Map();
  outcomes.forEach((outcome, index) => {
    const key = outcome.source_record_id;
    if (!key) return;
    const timestamp = Date.parse(outcome.recorded_at || "");
    const comparable = Number.isFinite(timestamp) ? timestamp : index;
    const previous = latest.get(key);
    if (!previous || comparable >= previous.comparable) latest.set(key, { outcome, comparable });
  });
  return [...latest.values()].map(({ outcome }) => outcome);
}

function summarizeOutcomes(outcomes) {
  const latest = latestOutcomes(outcomes);
  const failedIds = new Set(outcomes.filter((outcome) => outcome.status === "failed").map((outcome) => outcome.source_record_id));
  const resolvedFailureIds = new Set(
    latest
      .filter((outcome) => failedIds.has(outcome.source_record_id) && ["success", "skipped"].includes(outcome.status))
      .map((outcome) => outcome.source_record_id),
  );
  return {
    latest,
    attempt_statuses: distribution(outcomes.map((outcome) => outcome.status)),
    outcome_statuses: distribution(latest.map((outcome) => outcome.status)),
    exclusion_reasons: distribution(latest.filter((outcome) => outcome.status === "skipped").map((outcome) => outcome.reason)),
    failure_reasons: distribution(latest.filter((outcome) => outcome.status === "failed").map((outcome) => outcome.reason)),
    historical_failure_reasons: distribution(outcomes.filter((outcome) => outcome.status === "failed").map((outcome) => outcome.reason)),
    historical_failures: outcomes.filter((outcome) => outcome.status === "failed").length,
    current_failures: latest.filter((outcome) => outcome.status === "failed").length,
    resolved_failures: resolvedFailureIds.size,
  };
}

function selfTest() {
  const outcomes = [
    { source_record_id: "recovered", status: "failed", reason: "temporary", recorded_at: "2026-08-19T00:00:00Z" },
    { source_record_id: "still-bad", status: "failed", reason: "permanent", recorded_at: "2026-08-19T00:01:00Z" },
    { source_record_id: "recovered", status: "success", reason: null, recorded_at: "2026-08-19T00:02:00Z" },
    { source_record_id: "excluded", status: "skipped", reason: "no_video", recorded_at: "2026-08-19T00:03:00Z" },
  ];
  const summary = summarizeOutcomes(outcomes);
  const legacyCurrentFailures = outcomes.filter((outcome) => outcome.status === "failed").length;
  const passed = legacyCurrentFailures === 2
    && summary.current_failures === 1
    && summary.resolved_failures === 1
    && summary.outcome_statuses.success === 1
    && summary.outcome_statuses.failed === 1
    && summary.outcome_statuses.skipped === 1;
  return {
    ok: passed,
    red_to_green: {
      red: { ok: false, current_failures: legacyCurrentFailures, error: "HISTORICAL_FAILURES_COUNTED_AS_CURRENT" },
      green: { ok: passed, current_failures: summary.current_failures, resolved_failures: summary.resolved_failures, outcome_statuses: summary.outcome_statuses },
    },
  };
}

async function readOptional(file) {
  return file ? JSON.parse(await fs.readFile(file, "utf8")) : null;
}

function report(recordsPayload, checkpoint, contactSheets, inputs) {
  const records = recordsPayload.records || [];
  const videos = records.flatMap((record) =>
    (record.media_assets || [])
      .filter((asset) => asset.media_type === "video")
      .map((asset) => ({ record, asset })),
  );
  const sourceKeys = records.map((record) => `${record.source_site}:${record.source_record_id}`);
  const assetKeys = videos.map(({ record, asset }) => `${record.source_site}:${record.source_record_id}:${asset.asset_id}`);
  const canonicalMasterIds = videos.map(({ record, asset }) => asset.canonical_master_id || record.canonical_master_id).filter(Boolean);
  const masterRelations = videos.flatMap(({ asset }) => asset.master_relations || []);
  const brandComplete = records.filter((record) =>
    Boolean(record.primary_brand?.trim()) && (record.brands || []).some((brand) => brand?.trim()),
  ).length;
  const detailUrlComplete = records.filter((record) => /^https?:\/\//.test(record.source_detail_url || "")).length;
  const confirmedDates = records.filter((record) =>
    ["confirmed_2025", "confirmed_2026"].includes(record.campaign_year_status),
  ).length;
  const unverifiedDates = records.filter((record) => record.campaign_year_status === "campaign_date_unverified").length;
  const pendingCategory = records.filter((record) => record.classification_candidate?.status === "pending_category_review").length;
  const recordsWithVideo = records.filter((record) =>
    (record.media_assets || []).some((asset) => asset.media_type === "video"),
  ).length;
  const auditableVideoStatus = records.filter((record) =>
    (record.media_assets || []).some((asset) => asset.media_type === "video" && Boolean(asset.access_status)),
  ).length;
  const sheetRecords = contactSheets?.records || videos
    .filter(({ asset }) => asset.contact_sheet_status !== "pending")
    .map(({ asset }) => ({
      status: asset.contact_sheet_status === "available" ? "ok" : "error",
      sheet_validation: asset.ai_visual_pre_review?.frames_reviewed === 10 ? { frame_count: 10 } : null,
      temporary_video_cleanup: { remaining: [] },
    }));
  const sheetSuccess = sheetRecords.filter((item) => item.status === "ok" && item.sheet_validation?.frame_count === 10).length;
  const sheetFailure = sheetRecords.filter((item) => item.status !== "ok" || item.sheet_validation?.frame_count !== 10).length;
  const visualReviews = videos.map(({ asset }) => asset.ai_visual_pre_review).filter(Boolean);
  const completedVisualReviews = visualReviews.filter((review) => review.status === "completed");
  const outcomes = checkpoint?.outcomes || [];
  const outcomeSummary = summarizeOutcomes(outcomes);
  const candidates = checkpoint?.discovery?.candidates || [];
  const terminalIds = new Set(
    outcomeSummary.latest.filter((outcome) => ["success", "skipped"].includes(outcome.status)).map((outcome) => outcome.source_record_id),
  );

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source_site: recordsPayload.source_site || checkpoint?.source_site || null,
    inputs,
    discovery: checkpoint ? {
      complete: Boolean(checkpoint.discovery?.complete),
      candidates: candidates.length,
      completed_pages: checkpoint.discovery?.completed_pages?.length || 0,
      total_reported: checkpoint.discovery?.total_reported ?? null,
      last_page: checkpoint.discovery?.last_page ?? null,
      terminal_outcomes: terminalIds.size,
      remaining_candidates: candidates.filter((candidate) => !terminalIds.has(candidate.source_record_id)).length,
      latest_outcomes: outcomeSummary.latest.length,
      outcome_attempt_events: outcomes.length,
      outcome_statuses: outcomeSummary.outcome_statuses,
      exclusion_reasons: outcomeSummary.exclusion_reasons,
      failure_reasons: outcomeSummary.failure_reasons,
      attempt_statuses: outcomeSummary.attempt_statuses,
      historical_failure_reasons: outcomeSummary.historical_failure_reasons,
      historical_failures: outcomeSummary.historical_failures,
      current_failures: outcomeSummary.current_failures,
      resolved_failures: outcomeSummary.resolved_failures,
      retries: (checkpoint.runs || []).reduce((total, run) => total + Number(run.retried || 0), 0),
    } : null,
    coverage: {
      records: records.length,
      review_items: videos.length,
      brand_complete: brandComplete,
      brand_complete_rate: rate(brandComplete, records.length),
      detail_url_complete: detailUrlComplete,
      detail_url_complete_rate: rate(detailUrlComplete, records.length),
      date_confirmed: confirmedDates,
      date_confirmed_rate: rate(confirmedDates, records.length),
      date_unverified: unverifiedDates,
      date_unverified_rate: rate(unverifiedDates, records.length),
      records_with_video: recordsWithVideo,
      records_with_video_rate: rate(recordsWithVideo, records.length),
      records_with_auditable_video_status: auditableVideoStatus,
      records_with_auditable_video_status_rate: rate(auditableVideoStatus, records.length),
      pending_category_review: pendingCategory,
      pending_category_review_rate: rate(pendingCategory, records.length),
    },
    media: {
      providers: distribution(videos.map(({ asset }) => asset.provider)),
      access_statuses: distribution(videos.map(({ asset }) => asset.access_status)),
      contact_sheet_records: sheetRecords.length,
      contact_sheet_success: sheetSuccess,
      contact_sheet_failure: sheetFailure,
      contact_sheet_success_rate: rate(sheetSuccess, sheetRecords.length),
      temporary_video_residue: sheetRecords.reduce(
        (total, item) => total + (item.temporary_video_cleanup?.remaining?.length || 0),
        0,
      ),
    },
    classification: {
      industries: distribution(records.map((record) => record.classification_candidate?.industry || "pending")),
      product_categories: distribution(records.map((record) => record.classification_candidate?.product_category || "pending")),
      candidate_statuses: distribution(records.map((record) => record.classification_candidate?.status || "missing")),
    },
    visual_pre_review: {
      completed: completedVisualReviews.length,
      failed: visualReviews.filter((review) => review.status === "failed").length,
      coverage_rate: rate(completedVisualReviews.length, videos.length),
      content_natures: distribution(completedVisualReviews.map((review) => review.content_nature_candidate)),
      industry_candidates: distribution(completedVisualReviews.map((review) => review.industry_candidate)),
      product_category_candidates: distribution(
        completedVisualReviews.flatMap((review) => (review.product_category_candidates || []).map((candidate) => candidate.category)),
      ),
      exclusion_candidates: distribution(completedVisualReviews.flatMap((review) => review.exclusion_candidates || [])),
    },
    deduplication: {
      duplicate_source_records: duplicateCount(sourceKeys),
      duplicate_video_assets: duplicateCount(assetKeys),
      duplicate_discovery_candidates: duplicateCount(candidates.map((candidate) => candidate.source_record_id)),
      canonical_masters_assigned: canonicalMasterIds.length,
      unique_canonical_masters: new Set(canonicalMasterIds).size,
      shared_canonical_masters: Object.values(distribution(canonicalMasterIds))
        .filter((count) => count > 1).length,
      alternate_cut_links: masterRelations.filter((item) => item.relation === "alternate_cut").length,
      alternate_aspect_ratio_links: masterRelations.filter((item) => item.relation === "alternate_aspect_ratio").length,
      pending_canonical_review_links: masterRelations.filter((item) => item.relation === "pending_canonical_review").length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node collect/report-source-batch.mjs --records FILE [--checkpoint FILE] [--contact-sheets FILE] [--output FILE] [--self-test]");
    return;
  }
  if (args.selfTest) {
    const result = selfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  const [recordsPayload, checkpoint, contactSheets] = await Promise.all([
    readOptional(args.records),
    readOptional(args.checkpoint),
    readOptional(args.contactSheets),
  ]);
  const result = report(recordsPayload, checkpoint, contactSheets, {
    records: path.relative(process.cwd(), args.records),
    checkpoint: args.checkpoint ? path.relative(process.cwd(), args.checkpoint) : null,
    contact_sheets: args.contactSheets ? path.relative(process.cwd(), args.contactSheets) : null,
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    const temporary = `${args.output}.tmp`;
    await fs.writeFile(temporary, serialized, "utf8");
    await fs.rename(temporary, args.output);
  }
  process.stdout.write(serialized);
}

await main();
