import fs from "node:fs/promises";

if (process.env.ALLOW_LEGACY_MVP_REVIEW !== "1") {
  throw new Error(
    "build_consumer_electronics_v2.mjs 已停用：该旧流程会把搜索召回题材写入正式 genres。请按采集方案与优质判定标准 v3 完成独立视觉分类；仅审计历史结果时可设置 ALLOW_LEGACY_MVP_REVIEW=1。",
  );
}

const root = "/Users/hakunamatata/Desktop/AdGenie";
const filtered = JSON.parse(
  await fs.readFile(`${root}/collect/mvp-candidates-filtered-v1.json`, "utf8"),
);
const frameReview = JSON.parse(
  await fs.readFile(`${root}/collect/mvp-frame-review-v1.json`, "utf8"),
);
const libraryV5 = JSON.parse(
  await fs.readFile(`${root}/collect/library-v5.json`, "utf8"),
);

const TARGET_GENRES = [
  "TVC / Brand Commercial",
  "Macro Close-Up",
  "Multi-Angle / 360° Product Showcase",
  "Feature Callout",
  "Product Demo",
  "How-To Tutorial",
  "Unboxing",
  "Lookbook",
  "Daily Routine",
  "Walk-and-Talk UGC",
];

const reject = new Map([
  ["_h_NPobJkEA", ["TEARDOWN_NOT_CONSUMER_DEMO", "WEAK_AI_TEMPLATE_FIT"]],
  ["muXRq16J25M", ["TEARDOWN_NOT_CONSUMER_DEMO", "WEAK_AI_TEMPLATE_FIT"]],
  ["8ViInATeb6M", ["WRONG_PRIMARY_PRODUCT"]],
  ["o4apT17y4pM", ["PRODUCT_NOT_VISUAL_SUBJECT"]],
  ["dOuNLS1elWs", ["TALKING_HEAD_DOMINANT"]],
  ["toQJE8i0GW0", ["SOURCE_NOT_OFFICIAL"]],
  ["Q2zlSFiAlO8", ["SOURCE_NOT_OFFICIAL", "TALKING_HEAD_DOMINANT"]],
  ["mp2x2gpe2ak", ["TALKING_HEAD_DOMINANT"]],
  ["s3538Le5-_A", ["TALKING_HEAD_DOMINANT"]],
  ["6eaKnvJE32A", ["TALKING_HEAD_DOMINANT", "WEAK_AI_TEMPLATE_FIT"]],
  ["3Z-dPIoYeVo", ["WEAK_AI_TEMPLATE_FIT"]],
  ["5pLyTuzvNjs", ["WEAK_AI_TEMPLATE_FIT"]],
  ["Ae2hm6X-lhA", ["WEAK_AI_TEMPLATE_FIT"]],
  ["G4q1jpZe7vo", ["WEAK_AI_TEMPLATE_FIT"]],
  ["SJ2Ci4F05RU", ["WEAK_AI_TEMPLATE_FIT"]],
  ["uaEmAOtgqzs", ["WEAK_AI_TEMPLATE_FIT"]],
  ["yF_rD375k8Q", ["WEAK_AI_TEMPLATE_FIT"]],
  ["0J7afcVwc7M", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
  ["3FIdUxLf5yA", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
  ["i_CKp-ji84Q", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
  ["ZO7jPdj2mHg", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
  ["QToOe3aNDqY", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
  ["yNlLhqM7Km8", ["OUTDATED_LOW_TEMPLATE_VALUE"]],
]);

// One representative upload per substantive master. The representative is
// chosen for the clearest official source and the most complete visual edit.
const duplicateToKeeper = new Map([
  ["eH-PKTHDu3c", "EMmKs8vMKhU"],
  ["j5BCsz23898", "3yZkeQvNTcY"],
  ["iXhDlkmxrHU", "-BhntWD3oDA"],
  ["Jw71cIC6PIs", "7B-Orx7MO_U"],
  ["FtgZKd6WKr8", "bgqFL0z4B24"],
  ["_qGnftnFRYk", "bgqFL0z4B24"],
  ["zM5CZqW9IOg", "diq4Hwf7OQo"],
  ["Fj7mhBVRMjk", "KOK-GrrrjcQ"],
  ["oKKITJCaS3c", "KOK-GrrrjcQ"],
  ["SInW3C7I270", "ODI4zO0kFro"],
  ["9o0yvQWLp9c", "olHYA5c6jl4"],
  ["f-dMDIicE_A", "olHYA5c6jl4"],
  ["GP1KsgEvZow", "olHYA5c6jl4"],
  ["xmm9aDpEYLg", "olHYA5c6jl4"],
  ["yNlLhqM7Km8", "0owxU2E7Unc"],
  ["3wpjsZLtXP0", "3kL21CFJSO0"],
  ["K4F8yKsqh2I", "3kL21CFJSO0"],
  ["KeM00g05qbY", "Er6ppurPigo"],
  ["aTp7aBTEAf8", "H1R_YQLiGzk"],
  ["IMkAB9A7-fo", "bmaQzEGa-IQ"],
  ["VbZWGjrbDH4", "bmaQzEGa-IQ"],
  ["KjYbxxd6VWM", "rQKDmPZpnR8"],
  ["jWfm2o0m5Lg", "y3urXbiOQtQ"],
  ["OpuNEkGkcRw", "CUANvNUwFeI"],
  ["ptHVb8cLW9M", "nNmyT-OtHxU"],
]);

const visualGenreOverrides = new Map([
  ["Jwc-8sL_VSU", ["Product Demo"]],
  ["id2cLVIZh5Y", ["Product Demo", "Multi-Angle / 360° Product Showcase"]],
  ["yS6X0q4Nsws", ["Macro Close-Up", "Lookbook"]],
  ["BC42thmIcG0", ["Multi-Angle / 360° Product Showcase"]],
  ["olHYA5c6jl4", ["TVC / Brand Commercial", "Lookbook"]],
  ["iUKlfDmEwNA", ["Daily Routine"]],
  ["GP1KsgEvZow", ["Macro Close-Up", "Daily Routine"]],
  ["xa1LGVWoy30", ["Feature Callout", "How-To Tutorial"]],
  ["-7aSAWMUb6s", ["Feature Callout", "Unboxing"]],
]);

const frameById = new Map(frameReview.records.map((record) => [record.video_id, record]));
const candidateById = new Map(filtered.candidates.map((candidate) => [candidate.video_id, candidate]));

function reasonForHardFilter(record) {
  if (record.hard_filter_status === "excluded") {
    if (record.hard_filter_reasons.includes("duration_outside_16_119_seconds")) {
      return ["DURATION_OUT_OF_RANGE"];
    }
    return ["SOURCE_NOT_VERIFIED"];
  }
  return [];
}

function canonicalMasterId(videoId) {
  return duplicateToKeeper.get(videoId) || videoId;
}

function visualNotes(record, genres, status, reasonCodes) {
  const title = record.browser_metadata?.title || record.search_metadata.title;
  const duration = Math.round(record.browser_metadata?.duration_seconds || record.search_metadata.duration_seconds);
  if (status === "rejected") {
    const reason = reasonCodes.join(", ");
    return `${title}；${duration}s；${reason}`;
  }
  const genreText = genres.length ? genres.join("、") : "未形成目标题材标签";
  return `${title}；${duration}s；视觉主体为产品、功能或真实使用动作；成立题材：${genreText}`;
}

const records = filtered.candidates.map((candidate) => {
  const frame = frameById.get(candidate.video_id);
  const metadata = frame?.browser_metadata || {};
  const reasonCodes = [...reasonForHardFilter(frame || {})];
  let status = frame?.hard_filter_status === "passed" ? "accepted" : "rejected";
  let genres = [];

  if (reject.has(candidate.video_id)) {
    status = "rejected";
    reasonCodes.push(...reject.get(candidate.video_id));
  }
  if (duplicateToKeeper.has(candidate.video_id)) {
    status = "rejected";
    reasonCodes.push("DUPLICATE_MASTER");
  }
  if (status === "accepted") {
    genres = visualGenreOverrides.get(candidate.video_id) ||
      [...new Set(candidate.discovery_matches.map((match) => match.target_genre))];
    genres = genres.filter((genre) => TARGET_GENRES.includes(genre));
    if (!genres.length) {
      status = "rejected";
      reasonCodes.push("WEAK_AI_TEMPLATE_FIT");
    }
  }
  if (status === "accepted" && genres.includes("Daily Routine") && candidate.video_id === "id2cLVIZh5Y") {
    genres = genres.filter((genre) => genre !== "Daily Routine");
  }
  if (status === "accepted" && candidate.video_id === "P9JB-_RrBzs") {
    genres = ["Macro Close-Up", "Feature Callout", "How-To Tutorial"];
  }
  const uniqueReasons = [...new Set(reasonCodes)];
  return {
    video_id: candidate.video_id,
    url: candidate.url,
    product_category: candidate.discovery_matches[0].category,
    brand: candidate.channel,
    title: metadata.title || candidate.title,
    duration_seconds: Math.round(metadata.duration_seconds || candidate.duration_seconds),
    publish_date: metadata.publish_date || null,
    source_type: "品牌官方 / 官方地区或支持频道",
    status,
    reason_codes: uniqueReasons,
    genres,
    canonical_master_id: canonicalMasterId(candidate.video_id),
    visual_notes: visualNotes(frame, genres, status, uniqueReasons),
    ai_template_fit: status === "accepted" && genres.length > 0,
    frames_reviewed: Array.isArray(frame?.frames) ? frame.frames.length : 0,
  };
});

// Existing priority-category material is re-screened separately. Keep only
// official, product-forward, non-talking-head records that can be mapped to a
// target genre. The AI creator and creator-style talking-head entries are not
// carried into the new library.
const existingKeepIds = new Set([
  "DpcXUXtZ4CU",
  "EMmKs8vMKhU",
  "VlCspuGbrw8",
  "poMPwTC1HKY",
  "2jGFPugdyKo",
  "W0jOMHaEfzM",
  "vGY0SATxd6k",
  "JbFfpA39lPI",
  "ZoDDEz5Wue8",
]);
const existingRecords = libraryV5.videos
  .filter((video) => ["Power Banks", "True Wireless / Bluetooth Earbuds"].includes(video.product_category))
  .filter((video) => existingKeepIds.has(video.url.split("v=")[1]))
  .map((video) => ({
    video_id: video.url.split("v=")[1],
    url: video.url,
    product_category: video.product_category,
    brand: video.brand,
    title: video.title,
    duration_seconds: null,
    publish_date: null,
    source_type: video.source_type,
    status: "accepted",
    reason_codes: [],
    genres: video.genres.filter((genre) => TARGET_GENRES.includes(genre)),
    canonical_master_id: video.url.split("v=")[1],
    visual_notes: video.note || "既有优质样片；沿用原始题材标签",
    ai_template_fit: true,
    frames_reviewed: null,
  }));

const allRecords = [...existingRecords, ...records];
const uniqueByVideo = new Map();
for (const record of allRecords) {
  if (record.status !== "accepted" || !record.genres.length) continue;
  if (!uniqueByVideo.has(record.video_id)) uniqueByVideo.set(record.video_id, record);
}

const output = {
  version: 2,
  updated_at: new Date().toISOString(),
  criteria: {
    duration_seconds: "16-119",
    target_genres: TARGET_GENRES,
    counting_key: "product_category + genre + canonical_master_id",
    duplicate_rule: "same substantive advertising master across regional uploads counts once",
  },
  source_candidate_count: filtered.candidates.length,
  processed_count: records.length,
  accepted_count: records.filter((record) => record.status === "accepted").length,
  rejected_count: records.filter((record) => record.status === "rejected").length,
  records,
  existing_priority_records: existingRecords,
  accepted_priority_records: [...uniqueByVideo.values()],
};

await fs.writeFile(
  `${root}/collect/consumer-electronics-review-v2.json`,
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  output: `${root}/collect/consumer-electronics-review-v2.json`,
  processed: records.length,
  accepted: records.filter((record) => record.status === "accepted").length,
  rejected: records.filter((record) => record.status === "rejected").length,
  acceptedPriorityRecords: uniqueByVideo.size,
  acceptedByCategory: Object.fromEntries(
    [...new Set([...uniqueByVideo.values()].map((record) => record.product_category))]
      .map((category) => [category, [...uniqueByVideo.values()].filter((record) => record.product_category === category).length]),
  ),
}, null, 2));
