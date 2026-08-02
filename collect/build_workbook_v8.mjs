import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "/Users/hakunamatata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const repoRoot = "/Users/hakunamatata/Desktop/AdGenie";
const outputFile = process.env.WORKBOOK_OUTPUT || "AdGenie能力需求表-v8.xlsx";
const workbookVersion = outputFile.match(/v(\d+)/)?.[1] || "8";
const inputPath = process.env.INPUT_WORKBOOK
  ? path.join(repoRoot, process.env.INPUT_WORKBOOK)
  : path.join(repoRoot, "docs", "AdGenie能力需求表-v7.xlsx");
const outputDir = path.join(
  repoRoot,
  "outputs",
  "019fa13e-2d95-7993-bd68-c5eb1a26d8d6",
);
const outputPath = path.join(outputDir, outputFile);
const docsPath = path.join(repoRoot, "docs", outputFile);
const previewDir = path.join(outputDir, `v${workbookVersion}-previews`);

const library = JSON.parse(
  await fs.readFile(path.join(repoRoot, "collect", process.env.LIBRARY_FILE || "library-v6.json"), "utf8"),
);
const stats = JSON.parse(
  await fs.readFile(path.join(repoRoot, "collect", process.env.STATS_FILE || "stats-v6.json"), "utf8"),
);
const taxonomyData = JSON.parse(
  await fs.readFile(
    path.join(repoRoot, "collect", "consumer-electronics-taxonomy-v1.json"),
    "utf8",
  ),
);
const genreTaxonomyData = JSON.parse(
  await fs.readFile(
    path.join(repoRoot, "collect", "ad-video-genres-v1.json"),
    "utf8",
  ),
);
const reviewData = JSON.parse(
  await fs.readFile(
    path.join(repoRoot, "collect", process.env.REVIEW_FILE || "consumer-electronics-review-v2.json"),
    "utf8",
  ),
);

if (
  reviewData.criteria?.methodology_version !== "v3" &&
  process.env.ALLOW_LEGACY_MVP_REVIEW !== "1"
) {
  throw new Error(
    "消费电子 review 数据尚未声明 methodology_version=v3，不能作为新核心模板供给生成工作簿。仅审计历史输出时可设置 ALLOW_LEGACY_MVP_REVIEW=1。",
  );
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet0 = workbook.worksheets.getItem("0_说明");
const sheet1 = workbook.worksheets.getItem("1_广告类型题材");
const sheet2 = workbook.worksheets.getItem("2_题材×行业矩阵");
const sheet3 = workbook.worksheets.getItem("3_样片库");
const sheet4 = workbook.worksheets.getItem("4_待补采清单");
const sheet5 = workbook.worksheets.getItem("5_收集方法论");

const taxonomy = taxonomyData.categories;
const priorityCategories = [
  ["True Wireless / Bluetooth Earbuds", "真无线与蓝牙耳塞"],
  ["Power Banks", "充电宝"],
];
const targetGenres = reviewData.criteria.target_genres;
const newUrls = new Set(
  reviewData.records
    .filter((record) => record.status === "accepted")
    .map((record) => record.url),
);
const reviewByUrl = new Map(
  reviewData.records.map((record) => [record.url, record]),
);

const existingGenreRows = sheet1.getRange("A2:I30").values;
const existingStatusByEnglish = new Map(
  existingGenreRows.map((row) => [row[2], row[8]]),
);
const groupNameByCode = new Map(
  genreTaxonomyData.groups.map((group) => [group.code, group.name]),
);
const genreMeta = genreTaxonomyData.genres.map((item) => ({
  group: `${item.group} ${groupNameByCode.get(item.group)}`,
  order: item.order,
  english: item.english,
  zh: item.chinese,
  definition: item.definition,
  topviewSource: item.topview_sources.join(" · "),
  existingStatus: existingStatusByEnglish.get(item.english) || "待复核",
}));
const genreMetaByEnglish = new Map(
  genreMeta.map((item) => [item.english, item]),
);
const targetGenreMeta = targetGenres
  .map((english) => genreMetaByEnglish.get(english))
  .filter(Boolean);
const coreIndustries = [
  ["Consumer Electronics", "消费电子"],
  ["Skincare", "护肤"],
  ["Color Cosmetics", "彩妆"],
  ["Fragrance", "香水"],
  ["Personal Care", "洗护个护"],
  ["Jewelry & Watches", "珠宝腕表"],
  ["Apparel & Footwear", "服饰鞋履"],
  ["Bags & Accessories", "箱包配饰"],
  ["Home Appliances & Living", "家电家居"],
  ["Food & Beverage", "食品饮料"],
  ["Sports & Outdoor", "运动户外"],
];
const matrixIndustries = [...coreIndustries, ["Other", "其他（系统兜底）"]];

const genreCount = new Map();
const genreIndustryCount = new Map();
for (const video of library.videos) {
  for (const genre of video.genres) {
    genreCount.set(genre, (genreCount.get(genre) || 0) + 1);
    const key = `${genre}\u0000${video.industry}`;
    genreIndustryCount.set(key, (genreIndustryCount.get(key) || 0) + 1);
  }
}

const coreCellCounts = genreMeta.flatMap((genre) =>
  coreIndustries.map(([industry]) => genreIndustryCount.get(`${genre.english}\u0000${industry}`) || 0),
);
const coreCellsWithSamples = coreCellCounts.filter((count) => count > 0).length;
const coreCellsOk = coreCellCounts.filter((count) => count >= 3).length;

sheet0.getRange("A1").values = [
  [`AdGenie 能力需求表 v${workbookVersion} —— 广告类型题材 × 产品行业 × 消费电子商品品类模板矩阵`],
];
sheet0.getRange("B4").values = [[
  "① TopView skill 语义转化成什么广告类型　② 每个题材的内容定义与判断标准　③ 各行业下有哪些优质品牌广告样片　④ 消费电子商品品类 × 广告题材下有哪些可用模板视频　⑤ 怎么继续收集",
]];
sheet0.getRange("B9").values = [[
  "产品采用 11 个成熟用户心智主分类；按被销售产品及主要消费用途选择 1 个主行业。消费电子继续下钻 34 个商品品类，每条样片选择 1 个主商品品类；多产品跨品类仅作兜底，不计覆盖率。",
]];
sheet0.getRange("B10").values = [[
  `共 ${stats.total} 条：TopView 原有 ${stats.topview_original} + 后续采集 ${stats.later_collected} | 11 个主行业覆盖 ${coreCellsWithSamples}/${coreCellCounts.length} 格，达标(≥3) ${coreCellsOk} 格 | 两个 MVP 优先品类共 ${stats.consumer_electronics.priority_relation_count} 条母片级模板关系`,
]];
sheet0.getRange("B11").values = [[
  "逐条来自真实搜索结果的公开链接，无构造 URL；按公开元数据、浏览器播放与 10 点抽帧复核。判定标准与检索路径见 sheet 5。",
]];
sheet0.getRange("B16").values = [[
  `样片库 —— 共 ${stats.total} 条；每行一条视频，含主行业/品牌/题材多标签/来源/原始链接。消费电子优先品类的有效模板供给另在 sheet 7 按商品品类 × 题材展开。`,
]];
sheet0.getRange("A20:B20").values = [[
  "sheet 7",
  "消费电子商品品类 × 广告题材矩阵 —— MVP 首批两个商品品类 × 10 个题材的母片级有效模板数量，并提供可按两个维度筛选的模板视频明细。",
]];
sheet0.getRange("A20").format.font = { bold: true };
sheet0.getRange("A22:B22").values = [[
  "sheet 8",
  "消费电子模板明细 —— 将每条有效样片按商品品类 × 广告题材展开为独立关系行，供 MVP 数据映射和筛选。",
]];
sheet0.getRange("A22").format.font = { bold: true };

const updatedGenreRows = genreMeta.map((item) => {
  const total = genreCount.get(item.english) || 0;
  const covered = coreIndustries.filter(
    ([industry]) =>
      (genreIndustryCount.get(`${item.english}\u0000${industry}`) || 0) > 0,
  ).length;
  return [total, covered];
});
sheet1.getRange("A2:F30").values = genreMeta.map((item) => [
  item.group,
  item.order,
  item.english,
  item.zh,
  item.definition,
  item.topviewSource,
]);
sheet1.getRange("G2:H30").values = updatedGenreRows;

const matrixValues = [];
for (const genre of genreMeta) {
  const counts = matrixIndustries.map(
    ([industry]) =>
      genreIndustryCount.get(`${genre.english}\u0000${industry}`) || 0,
  );
  matrixValues.push([
    ...counts.map((count) => (count === 0 ? null : count)),
    counts.reduce((sum, count) => sum + count, 0),
  ]);
}
sheet2.getRange("C2:O30").values = matrixValues;
for (let rowIndex = 0; rowIndex < genreMeta.length; rowIndex += 1) {
  for (let colIndex = 0; colIndex < matrixIndustries.length; colIndex += 1) {
    const count = matrixValues[rowIndex][colIndex] || 0;
    const fill = count >= 3 ? "#E4F3E6" : count > 0 ? "#FFF6DC" : "#FCE4D6";
    sheet2.getCell(rowIndex + 1, colIndex + 2).format.fill = fill;
  }
}

const oldSampleRows = sheet3.getRange("A2:I600").values;
const oldSampleByUrl = new Map(
  oldSampleRows
    .filter((row) => row[7])
    .map((row) => [row[7], row]),
);
const genreLabels = Object.fromEntries(
  genreMeta.map((item) => [
    item.english,
    `${item.english}（${item.zh}）`,
  ]),
);
const orderedVideos = [
  ...library.videos.filter(
    (video) => video.industry === "Consumer Electronics",
  ),
  ...library.videos.filter(
    (video) => video.industry !== "Consumer Electronics",
  ),
];
const sampleRows = orderedVideos.map((video) => {
  const oldRow = oldSampleByUrl.get(video.url);
  if (oldRow) {
    return [
      ...oldRow.slice(0, 5),
      video.genres.map((genre) => genreLabels[genre] || genre).join(" / "),
      oldRow[6],
      video.url,
      video.note || oldRow[8],
    ];
  }
  return [
    "消费电子 MVP 优先品类扩充 2026-07-31",
    video.industry,
    "消费电子",
    video.brand,
    video.title,
    video.genres.map((genre) => genreLabels[genre] || genre).join(" / "),
    video.source_type,
    video.url,
    video.note,
  ];
});
sheet3.getRange("A2:I600").clear({ applyTo: "contents" });
sheet3.getRange(`A2:I${sampleRows.length + 1}`).values = sampleRows;
sheet3.getRange(`A312:I${sampleRows.length + 1}`).format = {
  font: { fontSize: 10, typeface: "Calibri" },
  verticalAlignment: "top",
};

const gapRows = [];
for (const genre of genreMeta) {
  for (const [industry, industryZh] of coreIndustries) {
    const count =
      genreIndustryCount.get(`${genre.english}\u0000${industry}`) || 0;
    if (count >= 3) continue;
    gapRows.push([
      count === 0 ? "P1" : "P2",
      genre.group,
      genre.english,
      genre.zh,
      `${industry} / ${industryZh}`,
      count,
      3 - count,
      genreCount.get(genre.english) || 0,
      "品牌官方频道 + 具体产品/战役名检索（方案文档 §2；消费电子商品缺口见 sheet 7）",
    ]);
  }
}
gapRows.sort((left, right) => {
  if (left[0] !== right[0]) return left[0].localeCompare(right[0]);
  const leftGenre = genreMeta.findIndex((item) => item.english === left[2]);
  const rightGenre = genreMeta.findIndex((item) => item.english === right[2]);
  if (leftGenre !== rightGenre) return leftGenre - rightGenre;
  const leftIndustry = coreIndustries.findIndex(
    ([industry]) => left[4].startsWith(industry),
  );
  const rightIndustry = coreIndustries.findIndex(
    ([industry]) => right[4].startsWith(industry),
  );
  return leftIndustry - rightIndustry;
});
sheet4.getRange("A2:I400").clear({ applyTo: "contents" });
sheet4.getRange(`A2:I${gapRows.length + 1}`).values = gapRows;

const methodRows = [
  [
    "十三、消费电子 MVP 新审核门与题材事实源（2026-08-01）",
    null,
    null,
  ],
  [
    "唯一事实源",
    "29 个题材的名称、分组和定义读取 collect/ad-video-genres-v1.json",
    "Markdown 和工作簿不再分别维护题材常量。",
  ],
  [
    "内容性质先行",
    "品牌官方来源不等于品牌品宣；主频道、地区频道、支持频道和媒体来源分开记录",
    "支持教程、发布会、测评、纪录片和幕后内容不能因官方来源直接进入核心模板。",
  ],
  [
    "年代门",
    "近 3 年优先；3–5 年需产品仍在售且视觉不过时；超过 5 年默认只进历史 / 灵感库",
    "经典例外单独审批，不计普通每格 10 条供给。",
  ],
  [
    "题材独立分类",
    "搜索词只用于召回；每条先确定 1 个主题材，次题材必须有独立连续画面证据",
    "Feature Callout 的卖点信息与 How-To 的顺序步骤不能因都有字幕而重复标注。",
  ],
  [
    "AI 生成价值",
    "至少 3 个可独立生成视觉段落，并有场景、构图、运动、材质、光影或动态图形发挥空间",
    "白底手动操作、录屏、静态步骤页和单一口播主导内容默认不进入核心模板。",
  ],
  [
    "Storyboard 证据",
    "0%–90% 十点抽帧只提供证据，必须另行记录内容性质、题材证据、口播占比、产品主体和 AI 价值",
    "frames_reviewed=10 不代表已经完成语义审核。",
  ],
  [
    "历史结果状态",
    `已处理 ${reviewData.processed_count} 条候选 / 补采记录；保留 ${reviewData.accepted_count} 条核心模板母片，展开为 ${stats.consumer_electronics.priority_relation_count} 条品类×题材关系`,
    "未达年代、内容性质、题材证据或 AI 模板价值门槛的样片均不计入。",
  ],
  [
    "回归案例",
    "Bose Proper Fit=支持教程；Galaxy Buds Live=年代过时；Anker Quick Start=低 AI 价值；Huawei FreeBuds Pro 3=Multi-Angle 非 Unboxing；Baseus Compact Power Bank=Feature/Demo 非 Daily Routine；Beats Emma=TVC 非 UGC/Lookbook；Belkin Magnetic Foldable=无线充电器非 Power Banks",
    "分类成立不等于模板资格成立；搜索召回题材不能直接成为正式标签。",
  ],
  [
    "计数",
    "商品品类 + 题材 + canonical_master_id；同一母片在同一格只计一次",
    "每格 10 条是供给目标，不构成降低质量门槛的理由。",
  ],
];
sheet5.getRange("A74:C90").clear({ applyTo: "contents" });
sheet5.getRange(`A74:C${73 + methodRows.length}`).values = methodRows;
sheet5.getRange("A74:C74").format = {
  fill: "#D9E5F0",
  font: { bold: true, color: "#1F3350" },
};
sheet5.getRange(`A75:C${73 + methodRows.length}`).format.wrapText = true;
sheet5.getRange(`A74:C${73 + methodRows.length}`).format.borders = {
  insideHorizontal: { style: "thin", color: "#E2E8F0" },
};

const existingSheet7 = workbook.worksheets.items.find(
  (sheet) => sheet.name === "7_消费电子商品品类",
);
const existingSheet8 = workbook.worksheets.items.find(
  (sheet) => sheet.name === "8_消费电子模板明细",
);
if (existingSheet8) {
  existingSheet8.delete();
}
const sheet7 = existingSheet7 || workbook.worksheets.add("7_消费电子商品品类");
const sheet8 = workbook.worksheets.add("8_消费电子模板明细");
sheet7.showGridLines = false;
sheet8.showGridLines = false;
// Reuse the imported sheet object. Deleting and recreating it can leave the
// old 34-category formulas attached to the exported sheet identity.
sheet7.getRange("A1:AK100").unmerge();
sheet7.getRange("A1:AK100").clear({ applyTo: "all" });
sheet7.getRange("F:AK").format.columnWidth = 0;
sheet7.getRange("21:100").format.rowHeight = 0;

const consumerVideos = library.videos.filter(
  (video) => video.industry === "Consumer Electronics",
);
const taxonomyByCategory = new Map(
  taxonomy.map((item) => [item.category, item]),
);
const categoryOrder = new Map(
  taxonomy.map((item, index) => [item.category, index]),
);
const genreOrder = new Map(
  genreMeta.map((item, index) => [item.english, index]),
);
const validConsumerVideos = consumerVideos.filter(
  (video) =>
    reviewByUrl.get(video.url)?.status === "accepted" &&
    taxonomyByCategory.has(video.product_category),
);
const detailRows = [];
for (const video of validConsumerVideos) {
  const category = taxonomyByCategory.get(video.product_category);
  for (const genre of video.genres) {
    const genreInfo = genreMetaByEnglish.get(genre);
    if (!genreInfo) continue;
    detailRows.push([
      video.product_category,
      category.zh,
      genreInfo.group,
      genre,
      genreInfo.zh,
      video.brand,
      video.title,
      newUrls.has(video.url) ? "本轮新增 / 已复核" : "既有有效样片",
      video.url,
      video.note || reviewByUrl.get(video.url)?.reason_codes.join(", ") || null,
    ]);
  }
}
detailRows.sort((left, right) => {
  const categoryDiff =
    categoryOrder.get(left[0]) - categoryOrder.get(right[0]);
  if (categoryDiff !== 0) return categoryDiff;
  const genreDiff = genreOrder.get(left[3]) - genreOrder.get(right[3]);
  if (genreDiff !== 0) return genreDiff;
  return `${left[5]} ${left[6]}`.localeCompare(`${right[5]} ${right[6]}`);
});

const detailStartRow = 6;
const detailEndRow = detailStartRow + detailRows.length - 1;
sheet8.mergeCells("A1:J1");
sheet8.getRange("A1").values = [[
  "Consumer Electronics 消费电子商品品类 × 广告题材 × 模板视频明细",
]];
sheet8.mergeCells("A2:J2");
sheet8.getRange("A2").values = [[
  "每行代表一个可用于 MVP 的“商品品类 × 广告题材 × 有效模板视频”关系。同一条视频包含多个成熟题材标签时会展开为多行；可直接筛选商品品类和广告题材。",
]];
sheet8.getRange("A3:J3").values = [[
  "有效视频",
  validConsumerVideos.length,
  "模板关系数",
  null,
  "商品品类",
  null,
  "广告题材",
  null,
  "统计口径",
  "仅已复核有效",
]];
sheet8.getRange("D3").formulas = [[`=COUNTA($A$${detailStartRow}:$A$${detailEndRow})`]];
sheet8.getRange("F3").formulas = [[
  `=COUNTA(UNIQUE($A$${detailStartRow}:$A$${detailEndRow}))`,
]];
sheet8.getRange("H3").formulas = [[
  "=COUNTA('7_消费电子商品品类'!$B$10:$B$19)",
]];
sheet8.getRange("A5:J5").values = [[
  "商品品类（英文）",
  "中文品类",
  "题材分组",
  "广告题材（英文）",
  "中文题材",
  "品牌 / 频道",
  "模板视频标题",
  "样片批次",
  "原始链接",
  "内容备注",
]];
sheet8.getRange(`A${detailStartRow}:J${detailEndRow}`).values = detailRows;
const templateDetailTable = sheet8.tables.add(
  `A5:J${detailEndRow}`,
  true,
  "ConsumerElectronicsTemplateMap",
);
templateDetailTable.showFilterButton = true;

sheet8.getRange("A1:J1").format = {
  fill: "#1F3350",
  font: { bold: true, color: "#FFFFFF", fontSize: 16, typeface: "Calibri" },
  verticalAlignment: "center",
};
sheet8.getRange("A1:J1").format.rowHeight = 30;
sheet8.getRange("A2:J2").format = {
  fill: "#EAF0F6",
  font: { color: "#334155", fontSize: 10, typeface: "Calibri" },
  wrapText: true,
  verticalAlignment: "center",
};
sheet8.getRange("A2:J2").format.rowHeight = 36;
for (const labelCell of ["A3", "C3", "E3", "G3", "I3"]) {
  sheet8.getRange(labelCell).format = {
    fill: "#D9E5F0",
    font: { bold: true, color: "#1F3350" },
    horizontalAlignment: "center",
  };
}
for (const valueCell of ["B3", "D3", "F3", "H3", "J3"]) {
  sheet8.getRange(valueCell).format = {
    fill: "#F5F8FB",
    font: { bold: true, color: "#1F3350" },
    horizontalAlignment: "center",
  };
}
sheet8.getRange("A5:J5").format = {
  fill: "#1F3350",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet8.getRange("A5:J5").format.rowHeight = 32;
sheet8.getRange(`A${detailStartRow}:J${detailEndRow}`).format = {
  font: { fontSize: 9, typeface: "Calibri", color: "#1F2937" },
  wrapText: true,
  verticalAlignment: "top",
  borders: {
    insideHorizontal: { style: "thin", color: "#E5E7EB" },
  },
};
sheet8.getRange(`A${detailStartRow}:J${detailEndRow}`).format.rowHeight = 34;
const detailWidths = {
  A: 40,
  B: 18,
  C: 22,
  D: 42,
  E: 22,
  F: 24,
  G: 58,
  H: 18,
  I: 62,
  J: 72,
};
for (const [column, width] of Object.entries(detailWidths)) {
  sheet8.getRange(`${column}:${column}`).format.columnWidth = width;
}
sheet8.freezePanes.freezeRows(5);
sheet8.freezePanes.freezeColumns(2);

const priorityTaxonomy = priorityCategories.map(([category, zh]) => ({ category, zh }));
const priorityGenreOrder = new Map(
  targetGenreMeta.map((item, index) => [item.english, index]),
);

sheet7.mergeCells("A1:E1");
sheet7.getRange("A1").values = [[
  "Consumer Electronics 消费电子：广告题材 × 商品品类有效模板矩阵",
]];
sheet7.mergeCells("A2:E2");
sheet7.getRange("A2").values = [[
  "用于 MVP 的双维度模板供给视图：用户先选择消费电子商品品类，再选择广告题材，查看对应模板视频。矩阵仅统计已复核有效样片；待复核、不计入和多产品跨品类样片均不作为模板供给。",
]];
sheet7.getRange("A3:E3").values = [[
  "目标品类",
  null,
  "广告题材",
  null,
  "有效组合格",
]];
sheet7.getRange("B3").formulas = [["=COUNTA($C$8:$D$8)"]];
sheet7.getRange("D3").formulas = [["=COUNTA($B$10:$B$19)"]];
sheet7.getRange("E3").formulas = [["=COUNTIF($C$10:$D$19,\">0\")"]];
sheet7.mergeCells("A5:E5");
sheet7.getRange("A5").values = [[
  "每格数字 = 该商品品类 × 该广告题材下去重后的有效母片数。绿色=达到当前供给目标（≥10）｜黄色=有样片但不足｜红色=空缺。相同母片的地区上传和语言剪辑不重复计数。",
]];
sheet7.mergeCells("A7:E7");
sheet7.getRange("A7").values = [["10 个广告题材 × 2 个 MVP 优先商品品类"]];
sheet7.getRange("A8:E8").values = [[
  "分组",
  "广告类型（英文）",
  ...priorityTaxonomy.map((item) => item.category),
  "合计",
]];
sheet7.getRange("C9:D9").values = [[
  ...priorityTaxonomy.map((item) => item.zh),
]];
sheet7.mergeCells("A8:A9");
sheet7.mergeCells("B8:B9");
sheet7.mergeCells("E8:E9");
sheet7.getRange("A10:B19").values = targetGenreMeta.map((item) => [
  item.group,
  `${item.english}\n${item.zh}`,
]);
sheet7.getRange("C10").formulas = [[
  `=COUNTIFS('8_消费电子模板明细'!$A$${detailStartRow}:$A$${detailEndRow},C$8,'8_消费电子模板明细'!$D$${detailStartRow}:$D$${detailEndRow},LEFT($B10,FIND(CHAR(10),$B10)-1))`,
]];
sheet7.getRange("C10:D10").fillRight();
sheet7.getRange("C10:D19").fillDown();
sheet7.getRange("E10").formulas = [["=SUM(C10:D10)"]];
sheet7.getRange("E10:E19").fillDown();
sheet7.mergeCells("A20:B20");
sheet7.getRange("A20").values = [["合计"]];
sheet7.getRange("C20").formulas = [["=SUM(C10:C19)"]];
sheet7.getRange("C20:D20").fillRight();
sheet7.getRange("E20").formulas = [["=SUM(E10:E19)"]];

for (let genreIndex = 0; genreIndex < targetGenreMeta.length; genreIndex += 1) {
  for (
    let categoryIndex = 0;
    categoryIndex < priorityTaxonomy.length;
    categoryIndex += 1
  ) {
    const count = detailRows.filter(
      (row) =>
        row[0] === priorityTaxonomy[categoryIndex].category &&
        row[3] === targetGenreMeta[genreIndex].english,
    ).length;
    const fill =
      count >= 10 ? "#E4F3E6" : count > 0 ? "#FFF6DC" : "#FCE4D6";
    sheet7
      .getCell(genreIndex + 9, categoryIndex + 2)
      .format.fill = fill;
  }
}

sheet7.getRange("A1:E1").format = {
  fill: "#1F3350",
  font: { bold: true, color: "#FFFFFF", fontSize: 16, typeface: "Calibri" },
  verticalAlignment: "center",
};
sheet7.getRange("A1:E1").format.rowHeight = 30;
sheet7.getRange("A2:E2").format = {
  fill: "#EAF0F6",
  font: { color: "#334155", fontSize: 10, typeface: "Calibri" },
  wrapText: true,
  verticalAlignment: "center",
};
sheet7.getRange("A2:E2").format.rowHeight = 36;
for (const labelCell of ["A3", "C3"]) {
  sheet7.getRange(labelCell).format = {
    fill: "#D9E5F0",
    font: { bold: true, color: "#1F3350" },
    horizontalAlignment: "center",
  };
}
for (const valueCell of ["B3", "D3", "E3"]) {
  sheet7.getRange(valueCell).format = {
    fill: "#F5F8FB",
    font: { bold: true, color: "#1F3350", fontSize: 14 },
    horizontalAlignment: "center",
    numberFormat: "#,##0",
  };
}
sheet7.getRange("A5:E5").format = {
  fill: "#FFF7E6",
  font: { color: "#7C4A03" },
  wrapText: true,
};
sheet7.getRange("A7:E7").format = {
  fill: "#D9E5F0",
  font: { bold: true, color: "#1F3350", fontSize: 12 },
};
sheet7.getRange("A8:E9").format = {
  fill: "#1F3350",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
sheet7.getRange("A8:E8").format.rowHeight = 48;
sheet7.getRange("A9:E9").format.rowHeight = 24;
sheet7.getRange("A10:E19").format = {
  font: { fontSize: 10, typeface: "Calibri", color: "#1F2937" },
  wrapText: true,
  verticalAlignment: "center",
  borders: {
    insideHorizontal: { style: "thin", color: "#E5E7EB" },
    insideVertical: { style: "thin", color: "#E5E7EB" },
    bottom: { style: "thin", color: "#CBD5E1" },
  },
};
sheet7.getRange("A10:E19").format.rowHeight = 38;
sheet7.getRange("C10:E20").format.horizontalAlignment = "center";
sheet7.getRange("A20:E20").format = {
  fill: "#EAF0F6",
  font: { bold: true, color: "#1F3350" },
  horizontalAlignment: "center",
  borders: { preset: "doubleBottom", style: "thin", color: "#94A3B8" },
};
sheet7.getRange("A:A").format.columnWidth = 23;
sheet7.getRange("B:B").format.columnWidth = 42;
sheet7.getRange("C:D").format.columnWidth = 24;
sheet7.getRange("E:E").format.columnWidth = 12;
sheet7.freezePanes.freezeRows(9);
sheet7.freezePanes.freezeColumns(2);

sheet7.getRange("F1:AK100").clear({ applyTo: "all" });
sheet7.getRange("A21:AK100").clear({ applyTo: "all" });

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.copyFile(outputPath, docsPath);

const sheetNames = [
  "0_说明",
  "1_广告类型题材",
  "2_题材×行业矩阵",
  "3_样片库",
  "4_待补采清单",
  "5_收集方法论",
  "6_可替换要素词频",
  "7_消费电子商品品类",
  "8_消费电子模板明细",
];
for (const sheetName of sheetNames) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const matrixInspect = await workbook.inspect({
  kind: "table",
  sheetId: "7_消费电子商品品类",
  range: "A1:E20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 5,
  maxChars: 30000,
});
const detailInspect = await workbook.inspect({
  kind: "table",
  sheetId: "8_消费电子模板明细",
  range: "A1:J10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 10,
  maxChars: 12000,
});
const errorInspect = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
await fs.writeFile(
  `${outputPath}.inspect.ndjson`,
  `${matrixInspect.ndjson}\n${detailInspect.ndjson}\n${errorInspect.ndjson}\n`,
);

console.log(
  JSON.stringify(
    {
      outputPath,
      docsPath,
      sheets: sheetNames.length,
      samples: sampleRows.length,
      gaps: gapRows.length,
      taxonomyCategories: taxonomy.length,
      validConsumerVideos: validConsumerVideos.length,
      detailRows: detailRows.length,
      formulaErrors: errorInspect.ndjson,
    },
    null,
    2,
  ),
);
