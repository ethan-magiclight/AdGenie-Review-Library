import fs from "node:fs/promises";
import path from "node:path";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const collectDir = path.join(root, "collect");
const baseReviewPath = path.join(collectDir, "consumer-electronics-review-v4.json");
const outputReviewPath = path.join(collectDir, "consumer-electronics-review-v5.json");
const outputGapReviewPath = path.join(collectDir, "consumer-electronics-gap-review-v1.json");

const sourceFiles = [
  "mvp-gap-enriched-v1-multi-unbox.json",
  "mvp-gap-enriched-v1-pb-hard-genres.json",
  "mvp-gap-enriched-v1-earbuds-hard-genres.json",
  "mvp-gap-enriched-v1-earbuds-multi-unbox-tail.json",
  "mvp-gap-enriched-v1-pb-hard-genres-tail.json",
  "mvp-gap-enriched-v1-earbuds-hard-genres-tail.json",
];

const decisions = [
  {
    video_id: "9YjjqMCW7Kw",
    status: "accepted",
    product_category: "Power Banks",
    brand: "Xiaomi",
    primary_genre: "TVC / Brand Commercial",
    secondary_genres: ["Feature Callout", "Product Demo"],
    content_nature: "brand_story_product_ad",
    ai_generation_value: "high",
    visual_notes:
      "剧情化西部场景建立用电冲突，22.8s 产品露出，34.2s 高密度电芯卖点，39.9s 双向快充演示，51.3s 产品收束；实际不是 Unboxing。",
  },
  {
    video_id: "4ZRBaV5etlA",
    status: "accepted",
    product_category: "Power Banks",
    brand: "Belkin",
    primary_genre: "Feature Callout",
    secondary_genres: [
      "Product Demo",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "黑底产品英雄镜头、端口/屏幕/容量/65W/多设备充电连续展示，产品多角度和卖点标注证据充足。",
  },
  {
    video_id: "lsE4YqFVrWs",
    status: "accepted",
    product_category: "Power Banks",
    brand: "CUKTECH",
    primary_genre: "Product Demo",
    secondary_genres: [
      "Feature Callout",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_lifestyle_video",
    ai_generation_value: "high",
    visual_notes:
      "工作台场景、接口/屏幕/外观细节、充电使用和产品英雄镜头连续出现；召回词命中 Unboxing，但画面没有开箱过程。",
  },
  {
    video_id: "h6DVhHfZMGY",
    status: "accepted",
    product_category: "Power Banks",
    brand: "UGREEN",
    primary_genre: "Product Demo",
    secondary_genres: [
      "Feature Callout",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_lifestyle_video",
    ai_generation_value: "high",
    visual_notes:
      "桌面、户外、摄影、电脑等场景展示 100W 供电和便携使用；属于产品功能/卖点展示，不是连续 Daily Routine。",
  },
  {
    video_id: "YMfJjI-RVNA",
    status: "accepted",
    product_category: "Power Banks",
    brand: "Belkin",
    primary_genre: "Feature Callout",
    secondary_genres: [
      "Product Demo",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "暗场产品台面、不同角度外观、40 小时续航、预充电、LED 状态与附带线材卖点连续展示；不是 Walk-and-Talk UGC。",
  },
  {
    video_id: "7tY2kt-9GhQ",
    status: "accepted",
    product_category: "Power Banks",
    brand: "Xiaomi",
    primary_genre: "Feature Callout",
    secondary_genres: ["Macro Close-Up", "Multi-Angle / 360° Product Showcase"],
    content_nature: "brand_product_design_feature_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "超薄外观、厚度对比、侧面和接口特写、产品英雄镜头构成设计卖点展示；不按 Lookbook 计数。",
  },
  {
    video_id: "GWJ3aNko7Uw",
    status: "accepted",
    product_category: "Power Banks",
    brand: "Baseus",
    primary_genre: "Feature Callout",
    secondary_genres: [
      "Product Demo",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_lifestyle_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "口袋携带、桌面充电、兼容场景、手持产品和动态图形卖点展示；有生活镜头但不构成连续 Daily Routine。",
  },
  {
    video_id: "QgsTaSS0CI4",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Huawei",
    primary_genre: "Multi-Angle / 360° Product Showcase",
    secondary_genres: ["Macro Close-Up", "Feature Callout"],
    content_nature: "brand_product_design_feature_video",
    ai_generation_value: "high",
    visual_notes:
      "FreeBuds Pro 3 绿色外观、耳机/充电盒/材质细节和音效卖点连续展示；不是 Unboxing。",
  },
  {
    video_id: "F1IPylsD7CI",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "OnePlus",
    primary_genre: "Feature Callout",
    secondary_genres: ["Product Demo", "Macro Close-Up"],
    content_nature: "brand_product_feature_lifestyle_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "录音/生活场景承接 ANC、触控音量、通话和设计卖点；产品多角度证据不够集中，因此不补 Multi-Angle。",
  },
  {
    video_id: "-L5Z-4t3RLA",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "OnePlus",
    primary_genre: "Multi-Angle / 360° Product Showcase",
    secondary_genres: ["Macro Close-Up", "Feature Callout", "Product Demo"],
    content_nature: "brand_product_design_feature_video",
    ai_generation_value: "high",
    visual_notes:
      "前段连续产品造型、佩戴、材质和声学空间展示，后段补充骑行/降噪/音质卖点；不是 Unboxing 或 UGC。",
  },
  {
    video_id: "Qb7eu0yQK3U",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Xiaomi",
    primary_genre: "Multi-Angle / 360° Product Showcase",
    secondary_genres: ["Macro Close-Up"],
    content_nature: "brand_product_design_feature_video",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "16s 高密度暗场产品英雄片，充电盒、耳机单体和材质光影多角度展示；不是 Walk-and-Talk UGC。",
  },
  {
    video_id: "Bt2iH0VaM20",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Jabra",
    primary_genre: "Feature Callout",
    secondary_genres: [
      "Product Demo",
      "Macro Close-Up",
      "Multi-Angle / 360° Product Showcase",
    ],
    content_nature: "brand_product_feature_video",
    ai_generation_value: "high",
    visual_notes:
      "Elite 10 以产品渲染、佩戴场景、ANC/空间音频/麦克风卖点构成品宣；不是连续 Daily Routine。",
  },
  {
    video_id: "_kfGcwCh8Us",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Sony",
    primary_genre: "Daily Routine",
    secondary_genres: ["Feature Callout", "Product Demo"],
    content_nature: "brand_product_lifestyle_routine_video",
    ai_generation_value: "high",
    visual_notes:
      "通勤、城市步行、咖啡/办公、户外步行和 App 调节等连续日常节点，产品/卖点贯穿；不是 Lookbook 或 Walk-and-Talk。",
  },
  {
    video_id: "CDYM7t0fZjE",
    status: "accepted",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Beats",
    primary_genre: "TVC / Brand Commercial",
    secondary_genres: ["Macro Close-Up"],
    content_nature: "brand_celebrity_concept_commercial",
    ai_generation_value: "moderate_to_high",
    visual_notes:
      "Emma Chamberlain 概念视觉广告，产品佩戴和包装收束清晰；不是 Walk-and-Talk UGC，也不硬标 Lookbook。",
  },
  {
    video_id: "-ggrxRcWFxI",
    status: "rejected",
    product_category: "Power Banks",
    brand: "Belkin",
    primary_genre: "Multi-Angle / 360° Product Showcase",
    secondary_genres: [],
    content_nature: "wrong_primary_product",
    ai_generation_value: "not_applicable",
    reason_codes: ["WRONG_PRIMARY_PRODUCT"],
    visual_notes:
      "内容主体是 BoostCharge Magnetic Foldable Wireless Charger，无内置电池移动电源属性；不能计入 Power Banks。",
  },
  {
    video_id: "O2aOx8t0GYg",
    status: "rejected",
    product_category: "Power Banks",
    brand: "Belkin",
    primary_genre: "Multi-Angle / 360° Product Showcase",
    secondary_genres: [],
    content_nature: "not_visually_verified",
    ai_generation_value: "unknown",
    reason_codes: ["FRAME_DOWNLOAD_FAILED", "NOT_VISUALLY_VERIFIED"],
    visual_notes: "元数据通过硬门槛，但低清视频下载失败，未完成 10 点视觉审计；本轮不入核心模板。",
  },
  {
    video_id: "oJ9bOZPu1Cw",
    status: "rejected",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Beats",
    primary_genre: "Testimonial / Review",
    secondary_genres: [],
    content_nature: "expert_review_compilation",
    ai_generation_value: "low",
    reason_codes: ["REVIEW_COMPILATION", "TALKING_HEAD_DOMINANT", "LOW_AI_CREATIVE_HEADROOM"],
    visual_notes:
      "专家/创作者评价片段主导，品牌官方发布但不是可迁移的品牌品宣模板；不补 Unboxing、Multi-Angle 或 Daily Routine。",
  },
  {
    video_id: "7t_8p4_Ih3k",
    status: "rejected",
    product_category: "Power Banks",
    brand: "Baseus",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "not_visually_verified",
    ai_generation_value: "unknown",
    reason_codes: ["FRAME_DOWNLOAD_FAILED", "NOT_VISUALLY_VERIFIED"],
    visual_notes: "元数据通过硬门槛，但低清视频下载失败，未完成 10 点视觉审计；本轮不入核心模板。",
  },
  {
    video_id: "e4t5vX14i1Q",
    status: "rejected",
    product_category: "Power Banks",
    brand: "Anker",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "support_tutorial",
    ai_generation_value: "low",
    reason_codes: ["SUPPORT_CONTENT", "LOW_AI_CREATIVE_HEADROOM"],
    visual_notes:
      "Anker Support Quick Setup Guide：顺序教程成立，但白底手动操作/支持说明为主，不是品牌品宣核心模板。",
  },
  {
    video_id: "IU_q-jVhJsI",
    status: "rejected",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Samsung",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "support_tutorial",
    ai_generation_value: "low",
    reason_codes: ["SUPPORT_CONTENT", "LOW_AI_CREATIVE_HEADROOM"],
    visual_notes:
      "Samsung Care 佩戴教程，解决购买后佩戴/贴合问题；不是 Lookbook，也不进入品牌品宣核心模板。",
  },
  {
    video_id: "geivoMDgPtc",
    status: "rejected",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "Sony",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "support_tutorial",
    ai_generation_value: "low",
    reason_codes: ["SUPPORT_CONTENT", "LOW_AI_CREATIVE_HEADROOM"],
    visual_notes:
      "Sony Support 佩戴教程，手动操作和说明步骤为主；How-To 成立但不是核心品牌品宣模板。",
  },
  {
    video_id: "sCYrElLdURQ",
    status: "rejected",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "JBL",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "brand_quick_tip",
    ai_generation_value: "low_to_moderate",
    reason_codes: ["LOW_AI_CREATIVE_HEADROOM", "QUICK_TIP_NOT_CORE_PROMO"],
    visual_notes:
      "JBL 官方 20s 控制教程，有品牌动效但主体是佩戴/触控/App 步骤，视觉段落单一；本轮不作为品宣核心模板。",
  },
  {
    video_id: "cUFx_4ZXLCM",
    status: "rejected",
    product_category: "True Wireless / Bluetooth Earbuds",
    brand: "OPPO",
    primary_genre: "How-To Tutorial",
    secondary_genres: [],
    content_nature: "support_tutorial",
    ai_generation_value: "unknown",
    reason_codes: ["FRAME_DOWNLOAD_FAILED", "SUPPORT_CONTENT", "NOT_VISUALLY_VERIFIED"],
    visual_notes:
      "OPPO Care 标题为 Unboxing/Pair/Reset guide，低清视频下载失败且内容性质偏售后支持；本轮不入核心模板。",
  },
];

const sourceRecords = new Map();
for (const file of sourceFiles) {
  const data = JSON.parse(await fs.readFile(path.join(collectDir, file), "utf8"));
  for (const record of data.records || []) {
    const existing = sourceRecords.get(record.video_id);
    if (existing) {
      existing.discovery_matches = [
        ...(existing.discovery_matches || []),
        ...(record.discovery_matches || []),
      ];
    } else {
      sourceRecords.set(record.video_id, { ...record, source_file: file });
    }
  }
}

const baseReview = JSON.parse(await fs.readFile(baseReviewPath, "utf8"));
const existingVideoIds = new Set(baseReview.records.map((record) => record.video_id));

function sourceFor(videoId) {
  const record = sourceRecords.get(videoId);
  if (!record) throw new Error(`Missing source record for ${videoId}`);
  return record;
}

function sourceType(record, decision) {
  const channel = record.enriched?.channel || record.channel || "";
  if (/support|care/i.test(channel) || decision.content_nature === "support_tutorial") {
    return "品牌支持 / 教程频道";
  }
  return "品牌官方 / 官方地区或支持频道";
}

function publisherRole(record, decision) {
  const channel = record.enriched?.channel || record.channel || "";
  if (/support|care/i.test(channel) || decision.content_nature === "support_tutorial") {
    return "brand_support_channel";
  }
  return "brand_main_or_official_regional_channel";
}

function recencyStatus(record) {
  const date = record.enriched?.publish_date;
  if (!date) return "unknown";
  return new Date(`${date}T00:00:00Z`) >= new Date("2023-08-01T00:00:00Z")
    ? "within_3_years"
    : "excluded_by_cutoff";
}

function buildRecord(decision) {
  const record = sourceFor(decision.video_id);
  const enriched = record.enriched || {};
  const genres = [
    decision.primary_genre,
    ...(decision.secondary_genres || []),
  ].filter(Boolean);
  const accepted = decision.status === "accepted";
  const duration = Number(enriched.duration_seconds || record.duration_seconds || 0);
  const title = enriched.title || record.title;
  return {
    video_id: decision.video_id,
    url: enriched.webpage_url || record.url || `https://www.youtube.com/watch?v=${decision.video_id}`,
    product_category: decision.product_category,
    brand: decision.brand,
    title,
    duration_seconds: duration || null,
    publish_date: enriched.publish_date || record.publish_date || null,
    source_type: sourceType(record, decision),
    status: decision.status,
    reason_codes: accepted ? [] : decision.reason_codes || [],
    genres,
    canonical_master_id: decision.video_id,
    visual_notes: `${title}；主题材：${decision.primary_genre || "不入库"}${
      decision.secondary_genres?.length ? `；次题材：${decision.secondary_genres.join(" / ")}` : ""
    }；${duration || "未知"}s；${decision.visual_notes}`,
    ai_template_fit: accepted,
    frames_reviewed: decision.reason_codes?.includes("NOT_VISUALLY_VERIFIED") ? 0 : 10,
    decision_reason_codes: accepted
      ? [
          "OFFICIAL_TOP_BRAND",
          "CURRENT_VISUAL_STANDARD",
          "AI_TEMPLATE_VALUE_CONFIRMED",
          "GAP_REVIEW_VISUAL_CONFIRMED",
        ]
      : decision.reason_codes || [],
    primary_genre: decision.primary_genre,
    secondary_genres: decision.secondary_genres || [],
    publisher_role: publisherRole(record, decision),
    content_nature: decision.content_nature,
    recency_status: recencyStatus(record),
    ai_generatable: accepted,
    ai_generation_value: decision.ai_generation_value,
    core_template_eligible: accepted,
    review_batch: "gap-fill-v1",
  };
}

const additionRecords = decisions
  .filter((decision) => !existingVideoIds.has(decision.video_id))
  .map(buildRecord);
const records = [...baseReview.records, ...additionRecords];
const acceptedRecords = records.filter((record) => record.status === "accepted");
const acceptedPriorityRecords = acceptedRecords.filter((record) =>
  ["Power Banks", "True Wireless / Bluetooth Earbuds"].includes(record.product_category),
);

const outputReview = {
  ...baseReview,
  version: "v5-gap-fill-review",
  updated_at: new Date().toISOString(),
  source_candidate_count: records.length,
  processed_count: records.length,
  accepted_count: acceptedRecords.length,
  rejected_count: records.filter((record) => record.status !== "accepted").length,
  criteria: {
    ...baseReview.criteria,
    review_version: "v5",
  },
  revision_notes: [
    ...baseReview.revision_notes,
    "Gap fill v1 added visually reviewed official candidates without inheriting discovery labels.",
    "Power Banks Multi-Angle and True Wireless / Bluetooth Earbuds Multi-Angle now reach the 10-master target.",
    "How-To, Unboxing, Lookbook, Daily Routine and Walk-and-Talk gaps remain unless samples clear both mature-label evidence and core-template gates.",
  ],
  records,
  accepted_priority_records: acceptedPriorityRecords,
  existing_priority_records: acceptedPriorityRecords,
};

const acceptedAdditions = additionRecords.filter((record) => record.status === "accepted");
const rejectedAdditions = additionRecords.filter((record) => record.status !== "accepted");
const hardExcludedSummary = [];
for (const file of sourceFiles) {
  const data = JSON.parse(await fs.readFile(path.join(collectDir, file), "utf8"));
  for (const record of data.records || []) {
    if (record.hard_filter_status === "excluded") {
      hardExcludedSummary.push({
        video_id: record.video_id,
        title: record.enriched?.title || record.title,
        channel: record.enriched?.channel || record.channel,
        publish_date: record.enriched?.publish_date || null,
        duration_seconds: record.enriched?.duration_seconds || record.duration_seconds || null,
        hard_filter_reasons: record.hard_filter_reasons || [],
      });
    }
  }
}

await fs.writeFile(outputReviewPath, `${JSON.stringify(outputReview, null, 2)}\n`, "utf8");
await fs.writeFile(
  outputGapReviewPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      base_review: "consumer-electronics-review-v4.json",
      output_review: "consumer-electronics-review-v5.json",
      source_files: sourceFiles,
      decision_count: additionRecords.length,
      accepted_count: acceptedAdditions.length,
      rejected_count: rejectedAdditions.length,
      accepted_additions: acceptedAdditions,
      rejected_additions: rejectedAdditions,
      hard_excluded_summary: hardExcludedSummary,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      output_review: outputReviewPath,
      output_gap_review: outputGapReviewPath,
      additions: additionRecords.length,
      accepted_additions: acceptedAdditions.length,
      rejected_additions: rejectedAdditions.length,
      total_records: outputReview.records.length,
      total_accepted: outputReview.accepted_count,
    },
    null,
    2,
  ),
);
