import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.join(collectRoot, "visual-pre-review-contract-v1.json");
const genresPath = path.join(collectRoot, "ad-video-genres-v1.json");

function parseArgs(argv) {
  const result = { records: null, reviews: null, output: null, dryRun: false, reviewedOnly: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${item}`);
      index += 1;
      return path.resolve(process.cwd(), value);
    };
    if (item === "--records") result.records = next();
    else if (item === "--reviews") result.reviews = next();
    else if (item === "--output") result.output = next();
    else if (item === "--dry-run") result.dryRun = true;
    else if (item === "--reviewed-only") result.reviewedOnly = true;
    else if (item === "--self-test") result.selfTest = true;
    else if (item === "--help" || item === "-h") {
      console.log("Usage: node collect/apply-visual-previews.mjs --records records.json --reviews reviews.json --output reviewed.json [--reviewed-only] [--dry-run] [--self-test]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${item}`);
  }
  if (!result.selfTest && (!result.records || !result.reviews || !result.output)) throw new Error("--records, --reviews, and --output are required");
  return result;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.campaigns || [];
}

function reviewsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.reviews || [];
}

function keyFor(review) {
  return `${review.source_site}:${review.source_record_id}:${review.asset_id}`;
}

function validateReview(review, contract, genreNames) {
  const errors = [];
  for (const field of contract.required_fields) {
    if (!Object.prototype.hasOwnProperty.call(review, field)) errors.push(`REQUIRED_FIELD_MISSING:${field}`);
  }
  if (!contract.allowed_statuses.includes(review.status)) errors.push("VISUAL_REVIEW_STATUS_INVALID");
  if (review.status === "failed") {
    if (!review.failure_reason) errors.push("FAILED_REVIEW_REASON_REQUIRED");
    return errors;
  }
  if (Number(review.frames_reviewed) !== 10) errors.push("EXACTLY_10_FRAMES_REQUIRED");
  if (!contract.allowed_content_natures.includes(review.content_nature_candidate)) errors.push("CONTENT_NATURE_CANDIDATE_INVALID");
  if (!String(review.product_subject || "").trim()) errors.push("PRODUCT_SUBJECT_REQUIRED");
  if (!String(review.industry_candidate || "").trim()) errors.push("INDUSTRY_CANDIDATE_REQUIRED");
  if (!Array.isArray(review.product_category_candidates) || !review.product_category_candidates.length) errors.push("PRODUCT_CATEGORY_CANDIDATES_REQUIRED");
  for (const candidate of review.product_category_candidates || []) {
    if (!candidate.category || !Number.isFinite(candidate.confidence) || !Array.isArray(candidate.evidence) || !candidate.evidence.length) errors.push("PRODUCT_CATEGORY_CANDIDATE_EVIDENCE_INVALID");
  }
  if (!Array.isArray(review.genre_candidates)) errors.push("GENRE_CANDIDATES_ARRAY_REQUIRED");
  for (const candidate of review.genre_candidates || []) {
    if (!genreNames.has(candidate.genre)) errors.push(`UNKNOWN_GENRE_CANDIDATE:${candidate.genre}`);
    if (!Number.isFinite(candidate.confidence) || !Array.isArray(candidate.evidence) || !candidate.evidence.length) errors.push(`GENRE_CANDIDATE_EVIDENCE_INVALID:${candidate.genre}`);
  }
  for (const field of contract.required_ad_structure) {
    if (typeof review.ad_structure?.[field] !== "boolean") errors.push(`AD_STRUCTURE_BOOLEAN_REQUIRED:${field}`);
  }
  for (const field of ["score", "craft", "clarity", "brand_legibility"]) {
    const value = review.visual_quality?.[field];
    if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`VISUAL_QUALITY_SCORE_INVALID:${field}`);
  }
  if (!Number.isFinite(review.template_value?.score) || review.template_value.score < 0 || review.template_value.score > 100 || !review.template_value?.reason) errors.push("TEMPLATE_VALUE_INVALID");
  if (!Array.isArray(review.exclusion_candidates)) errors.push("EXCLUSION_CANDIDATES_ARRAY_REQUIRED");
  if (!String(review.summary || "").trim()) errors.push("VISUAL_REVIEW_SUMMARY_REQUIRED");
  return [...new Set(errors)];
}

function validReview() {
  return {
    source_site: "ads_of_the_world",
    source_record_id: "fixture",
    asset_id: "fixture-video",
    status: "completed",
    contact_sheet_path: "collect/runs/fixture/contact-sheet.jpg",
    frames_reviewed: 10,
    content_nature_candidate: "brand_commercial",
    product_subject: "Packaged snack product",
    industry_candidate: "Food & Beverage",
    product_category_candidates: [{ category: "Confectionery & Snacks", confidence: 0.9, evidence: ["Product pack and eating moment visible"] }],
    genre_candidates: [{ genre: "TVC / Brand Commercial", confidence: 0.8, evidence: ["Hook, proposition, product proof and brand close visible"] }],
    ad_structure: { hook: true, commercial_proposition: true, product_proof: true, brand_close: true },
    visual_quality: { score: 80, craft: 82, clarity: 78, brand_legibility: 80 },
    template_value: { score: 76, reason: "Clear repeatable product-led structure" },
    exclusion_candidates: [],
    summary: "Product-led commercial with a clear branded close.",
  };
}

function selfTest(contract, genreNames) {
  const tests = [];
  for (const [name, mutate, expected] of [
    ["nine_frames", (review) => { review.frames_reviewed = 9; }, "EXACTLY_10_FRAMES_REQUIRED"],
    ["unknown_genre", (review) => { review.genre_candidates[0].genre = "Invented Formal Genre"; }, "UNKNOWN_GENRE_CANDIDATE"],
  ]) {
    const redReview = structuredClone(validReview());
    mutate(redReview);
    const red = validateReview(redReview, contract, genreNames);
    const green = validateReview(validReview(), contract, genreNames);
    tests.push({ case: name, red: { ok: red.length === 0, errors: red }, green: { ok: green.length === 0 }, passed: red.some((error) => error.includes(expected)) && green.length === 0 });
  }
  return { ok: tests.every((test) => test.passed), red_to_green: tests };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [contract, genres] = await Promise.all([
    fs.readFile(contractPath, "utf8").then(JSON.parse),
    fs.readFile(genresPath, "utf8").then(JSON.parse),
  ]);
  const genreNames = new Set((genres.genres || []).map((genre) => genre.english));
  if (args.selfTest) {
    const summary = selfTest(contract, genreNames);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exit(1);
    return;
  }

  const recordPayload = JSON.parse(await fs.readFile(args.records, "utf8"));
  const reviewPayload = JSON.parse(await fs.readFile(args.reviews, "utf8"));
  const records = recordsFrom(recordPayload);
  const reviews = reviewsFrom(reviewPayload);
  const assetIndex = new Map();
  for (const record of records) {
    for (const asset of record.media_assets || []) assetIndex.set(`${record.source_site}:${record.source_record_id}:${asset.asset_id}`, { record, asset });
  }
  const errors = [];
  let applied = 0;
  for (const review of reviews) {
    const reviewErrors = validateReview(review, contract, genreNames);
    if (reviewErrors.length) {
      errors.push({ key: keyFor(review), errors: reviewErrors });
      continue;
    }
    const target = assetIndex.get(keyFor(review));
    if (!target) {
      errors.push({ key: keyFor(review), errors: ["SOURCE_MEDIA_ASSET_NOT_FOUND"] });
      continue;
    }
    target.asset.ai_visual_pre_review = review;
    applied += 1;
  }
  for (const record of records) {
    if ((record.genres || []).length) errors.push({ key: `${record.source_site}:${record.source_record_id}`, errors: ["FORMAL_GENRES_MUTATION_FORBIDDEN"] });
    if (record.approved !== false) errors.push({ key: `${record.source_site}:${record.source_record_id}`, errors: ["APPROVED_MUTATION_FORBIDDEN"] });
    if (record.core_template_eligible !== false) errors.push({ key: `${record.source_site}:${record.source_record_id}`, errors: ["CORE_TEMPLATE_MUTATION_FORBIDDEN"] });
  }
  const outputRecords = args.reviewedOnly
    ? records.filter((record) => (record.media_assets || []).some((asset) => asset.ai_visual_pre_review?.status === "completed"))
    : records;
  const summary = { ok: errors.length === 0, dry_run: args.dryRun, records: records.length, output_records: outputRecords.length, reviews: reviews.length, applied, formal_genres_written: 0, approval_mutations: 0, errors };
  if (!args.dryRun && summary.ok) {
    const output = { ...recordPayload, records: outputRecords, visual_pre_review_applied_at: new Date().toISOString() };
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

await main();
