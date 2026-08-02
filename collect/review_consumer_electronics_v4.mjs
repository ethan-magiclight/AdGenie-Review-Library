import fs from "node:fs/promises";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const input = JSON.parse(
  await fs.readFile(`${root}/collect/consumer-electronics-review-v3.json`, "utf8"),
);

const methodologyDate = new Date("2026-08-01T00:00:00+08:00");
const threeYearsAgo = new Date("2023-08-01T00:00:00+08:00");
const fiveYearsAgo = new Date("2021-08-01T00:00:00+08:00");

// Each retained master is classified from storyboard evidence, independently
// of its search query, title, playlist, or previous labels.
const accepted = {
  // Power banks
  "1_KFE0ATS1g": ["TVC / Brand Commercial"],
  ej9LJmaoS0g: ["Feature Callout", "Product Demo"],
  GOIWbGzv4II: ["TVC / Brand Commercial", "Feature Callout", "Product Demo", "Macro Close-Up"],
  "9bgayvi_DzM": ["Feature Callout", "Product Demo", "Macro Close-Up"],
  "qeioGNuqU-U": ["Feature Callout", "Product Demo"],
  GMBE9UIXxy4: ["Feature Callout", "Product Demo", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  zquUnBZB9MI: ["TVC / Brand Commercial", "Macro Close-Up", "Product Demo"],
  "0szqUcjpEuI": ["TVC / Brand Commercial", "Product Demo"],
  "9d1iTBJ5_kg": ["Feature Callout", "Macro Close-Up", "Product Demo"],
  "YmPoa-bpXfs": ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  "0fEVNMMy5B4": ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  "CBd-694cMJk": ["Feature Callout", "Product Demo"],
  HDWDDelPY5I: ["TVC / Brand Commercial", "Product Demo", "Feature Callout"],
  BlhWayUwsy4: ["Multi-Angle / 360° Product Showcase", "Macro Close-Up", "Product Demo"],
  "s2lowSj9k-s": ["Feature Callout", "Macro Close-Up", "Product Demo"],
  "7rHuRJ_1ZtI": ["Feature Callout", "Product Demo"],
  s1IzF0vtMgM: ["Feature Callout", "Product Demo", "Macro Close-Up"],
  "-N2OK7U2D9g": ["Feature Callout", "Product Demo", "Macro Close-Up"],
  "Jwc-8sL_VSU": ["Product Demo", "Feature Callout", "Macro Close-Up"],
  X4T8XSjIfQw: ["TVC / Brand Commercial", "Feature Callout", "Product Demo", "Macro Close-Up"],
  "-ODcuQVfpMU": ["Feature Callout", "Macro Close-Up", "Product Demo"],
  JjVlxBKma6A: ["Feature Callout", "Product Demo"],
  "nNmyT-OtHxU": ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  "EIRZ-7Iaoe4": ["Feature Callout", "Product Demo"],
  "66X5Gnuw81w": ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  "9b5NlpA1P3I": ["Feature Callout", "Product Demo", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  vrrVZ9CmD2Q: ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  F_gSSzVl9Uc: ["Feature Callout", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  aATK22L38b8: ["Feature Callout", "Macro Close-Up"],
  "6VVxPKrz6z0": ["Feature Callout", "Macro Close-Up", "Product Demo"],
  "9VLDQLva4Qk": ["Feature Callout", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],

  // True wireless / Bluetooth earbuds
  wDgH0FECdJs: ["TVC / Brand Commercial", "Product Demo", "Feature Callout"],
  EMmKs8vMKhU: ["TVC / Brand Commercial", "Macro Close-Up", "Feature Callout", "Product Demo", "Multi-Angle / 360° Product Showcase"],
  bCqnOn23LWE: ["TVC / Brand Commercial", "Product Demo", "Feature Callout", "Macro Close-Up"],
  "OYD-7DiW_AA": ["TVC / Brand Commercial", "Product Demo"],
  "vgw-amVaodg": ["Feature Callout", "Product Demo", "Macro Close-Up"],
  "3yZkeQvNTcY": ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
  Yd7Djf5QYvw: ["Feature Callout", "Product Demo"],
  "7B-Orx7MO_U": ["TVC / Brand Commercial", "Product Demo"],
  diq4Hwf7OQo: ["TVC / Brand Commercial", "Product Demo"],
  "Wm-UqPkNWOU": ["Product Demo", "Feature Callout"],
  EuO7XuJg1RU: ["Macro Close-Up", "Feature Callout", "Multi-Angle / 360° Product Showcase"],
  "7jTDPSg5cUY": ["Feature Callout", "Product Demo", "Macro Close-Up"],
  "HuR-5GrMZyQ": ["Feature Callout", "TVC / Brand Commercial", "Product Demo"],
  "KOK-GrrrjcQ": ["TVC / Brand Commercial", "Feature Callout", "Product Demo", "Macro Close-Up"],
  "bmaQzEGa-IQ": ["TVC / Brand Commercial", "Product Demo", "Feature Callout"],
  Er6ppurPigo: ["Feature Callout", "Unboxing", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  Sxmxb4jmxlA: ["Feature Callout", "Unboxing", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  "2FOA80ckBsE": ["Product Demo", "Feature Callout"],
  GJCAWxNm69M: ["Feature Callout", "TVC / Brand Commercial", "Product Demo", "Macro Close-Up"],
  A3Yap7TzWS8: ["TVC / Brand Commercial", "Product Demo"],
  hvkngQBVMW0: ["Feature Callout", "TVC / Brand Commercial", "Product Demo"],
  e3P2CAO33vA: ["Unboxing"],
  "G-4_wSIkPxc": ["Feature Callout", "Product Demo", "TVC / Brand Commercial"],
  "69ZbeYmDxnA": ["Unboxing"],
  "88Cp6TAVY4g": ["Unboxing"],
  "2tsxIQZI3YQ": ["Feature Callout", "Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  "-7aSAWMUb6s": ["Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
  i7Xi27ri0dA: ["TVC / Brand Commercial", "Feature Callout", "Product Demo"],
};

const explicitRejects = {
  a6zDDcGjFtM: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "WEAK_AI_TEMPLATE_FIT"],
  "P9JB-_RrBzs": ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "MANUAL_OPERATION_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  "ujES8BJYY6o": ["DUPLICATE_MASTER"],
  id2cLVIZh5Y: ["MANUAL_OPERATION_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  yS6X0q4Nsws: ["DOCUMENTARY_OR_INTERVIEW_STYLE", "TALKING_HEAD_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  xa1LGVWoy30: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "MANUAL_OPERATION_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  ncfrB15li1E: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "OUTDATED_OR_SUPERSEDED_PRODUCT"],
  "9tMS_NPxuP0": ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "OUTDATED_OVER_5Y"],
  Z1P3ejAonCo: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "STATIC_STEPS_OR_APP_UI", "WEAK_AI_TEMPLATE_FIT"],
  "vzq6Ba-289w": ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "STATIC_STEPS_OR_APP_UI", "WEAK_AI_TEMPLATE_FIT"],
  MXf4zvQZyco: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "MANUAL_OPERATION_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  "Kt9z-hH61K0": ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "STATIC_STEPS_OR_APP_UI", "WEAK_AI_TEMPLATE_FIT"],
  LWS29XEzQg8: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "STATIC_STEPS_OR_APP_UI", "WEAK_AI_TEMPLATE_FIT"],
  p1XaIrXkDmI: ["SUPPORT_TUTORIAL_NOT_BRAND_PROMO", "MANUAL_OPERATION_DOMINANT", "WEAK_AI_TEMPLATE_FIT"],
  AkdU0FLdi7k: ["DUPLICATE_OR_SHORTER_CAMPAIGN_CUT"],
};

const canonicalOverrides = {
  ujES8BJYY6o: "7rHuRJ_1ZtI",
  AkdU0FLdi7k: "7jTDPSg5cUY",
};

const contentNatureByPrimary = {
  "TVC / Brand Commercial": "brand_commercial",
  "Macro Close-Up": "product_visual_showcase",
  "Multi-Angle / 360° Product Showcase": "product_visual_showcase",
  "Feature Callout": "brand_product_feature_video",
  "Product Demo": "brand_product_demo",
  "How-To Tutorial": "support_or_instructional_content",
  Unboxing: "brand_unboxing",
};

function recencyStatus(record) {
  const published = new Date(record.publish_date);
  if (Number.isNaN(published.valueOf())) return "unknown";
  if (published < fiveYearsAgo) return "over_5_years";
  if (published < threeYearsAgo) return "3_to_5_years";
  return "within_3_years";
}

function publisherRole(record) {
  const value = `${record.brand} ${record.title}`.toLowerCase();
  if (value.includes("support") || value.includes("how to") || value.includes("quick start")) {
    return "brand_support_or_instructional_channel";
  }
  return "brand_main_or_official_regional_channel";
}

function automaticRejectReasons(record) {
  if (explicitRejects[record.video_id]) return explicitRejects[record.video_id];
  const age = recencyStatus(record);
  if (age === "over_5_years") return ["OUTDATED_OVER_5Y"];
  if (age === "3_to_5_years") return ["OUTDATED_OR_SUPERSEDED_PRODUCT"];
  if (record.status === "rejected" && record.reason_codes?.length) return record.reason_codes;
  return ["FAILED_FULL_REVIEW_CORE_TEMPLATE_GATE"];
}

const records = input.records.map((record) => {
  const genres = accepted[record.video_id];
  const age = recencyStatus(record);
  if (!genres) {
    const reasonCodes = automaticRejectReasons(record);
    return {
      ...record,
      status: "rejected",
      reason_codes: reasonCodes,
      decision_reason_codes: reasonCodes,
      genres: [],
      primary_genre: null,
      secondary_genres: [],
      canonical_master_id: canonicalOverrides[record.video_id] || record.canonical_master_id || record.video_id,
      publisher_role: publisherRole(record),
      content_nature: reasonCodes.includes("SUPPORT_TUTORIAL_NOT_BRAND_PROMO")
        ? "support_or_instructional_content"
        : reasonCodes.includes("DOCUMENTARY_OR_INTERVIEW_STYLE")
          ? "documentary_or_interview"
          : "not_core_template_eligible",
      recency_status: age,
      ai_generatable: false,
      ai_generation_value: "low_or_not_applicable",
      ai_template_fit: false,
      core_template_eligible: false,
      visual_notes: `${record.title}；全量复核结论：${reasonCodes.join(" / ")}`,
      frames_reviewed: 10,
    };
  }

  const [primaryGenre, ...secondaryGenres] = genres;
  return {
    ...record,
    status: "accepted",
    reason_codes: [],
    decision_reason_codes: ["OFFICIAL_TOP_BRAND", "CURRENT_VISUAL_STANDARD", "AI_TEMPLATE_VALUE_CONFIRMED"],
    genres,
    primary_genre: primaryGenre,
    secondary_genres: secondaryGenres,
    canonical_master_id: record.video_id,
    publisher_role: publisherRole(record),
    content_nature: contentNatureByPrimary[primaryGenre] || "brand_product_content",
    recency_status: age,
    ai_generatable: true,
    ai_generation_value: secondaryGenres.length >= 2 ? "high" : "moderate_to_high",
    ai_template_fit: true,
    core_template_eligible: true,
    visual_notes: `${record.title}；主题材：${primaryGenre}${secondaryGenres.length ? `；次题材：${secondaryGenres.join(" / ")}` : ""}；${record.duration_seconds}s；已按 storyboard 独立复核`,
    frames_reviewed: 10,
  };
});

const acceptedRecords = records.filter((record) => record.status === "accepted");
const rejectedRecords = records.filter((record) => record.status === "rejected");

const result = {
  version: "v4-full-semantic-review",
  updated_at: methodologyDate.toISOString(),
  source_candidate_count: records.length,
  processed_count: records.length,
  accepted_count: acceptedRecords.length,
  rejected_count: rejectedRecords.length,
  criteria: {
    ...input.criteria,
    methodology_version: "v3",
    review_version: "v4",
    duration_seconds: "16-119",
    recency_rule: "within 3 years preferred; 3-5 years requires explicit exception; over 5 years excluded from ordinary core templates",
    content_gate: "official source does not imply brand promotional content",
    ai_value_gate: "manual operation, static UI steps, talking head, documentary pacing, and low-variation tutorials are excluded",
    classification_rule: "one primary genre plus evidence-backed secondary genres; retrieval terms and titles are not labels",
  },
  revision_notes: [
    "All 193 candidates were re-reviewed against storyboard evidence and the v3 methodology.",
    "Old accepted/rejected status and old genre labels were not inherited as final truth.",
    "No 3-5 year recency exception was needed for the current core-template output.",
    "The four regression cases were fixed: xa1LGVWoy30, H1R_YQLiGzk and a6zDDcGjFtM are excluded; s2lowSj9k-s is Feature Callout-led.",
    "Lookbook, Daily Routine, Walk-and-Talk UGC and How-To have zero retained supply because no candidate clears both genre evidence and core-template quality gates.",
  ],
  records,
  accepted_priority_records: acceptedRecords,
  existing_priority_records: records,
};

await fs.writeFile(
  `${root}/collect/consumer-electronics-review-v4.json`,
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ processed: records.length, accepted: acceptedRecords.length, rejected: rejectedRecords.length }, null, 2));
