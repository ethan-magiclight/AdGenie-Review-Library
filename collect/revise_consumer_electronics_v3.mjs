import fs from "node:fs/promises";

if (process.env.ALLOW_LEGACY_MVP_REVIEW !== "1") {
  throw new Error(
    "revise_consumer_electronics_v3.mjs 已停用：视频 ID 增删标签不能替代全量视觉重审。仅审计历史结果时可设置 ALLOW_LEGACY_MVP_REVIEW=1。",
  );
}

const root = "/Users/hakunamatata/Desktop/AdGenie";
const sourcePath = `${root}/collect/consumer-electronics-review-v2.json`;
const outputPath = `${root}/collect/consumer-electronics-review-v3.json`;

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));

// These are corrections from the existing ten-frame evidence. They remove
// labels that were inferred from titles rather than the visible structure,
// and add only demonstrated product-action labels.
const removeGenres = new Map([
  ["ej9LJmaoS0g", ["How-To Tutorial"]],
  ["2jutZa3fzwA", ["How-To Tutorial"]],
  ["9bgayvi_DzM", ["How-To Tutorial"]],
  ["iDyvtEOXSgQ", ["How-To Tutorial"]],
  ["-ODcuQVfpMU", ["How-To Tutorial"]],
  ["X4T8XSjIfQw", ["How-To Tutorial"]],
  ["EIRZ-7Iaoe4", ["How-To Tutorial", "Unboxing"]],
  ["66X5Gnuw81w", ["How-To Tutorial", "Unboxing"]],
  ["aATK22L38b8", ["How-To Tutorial"]],
  ["6VVxPKrz6z0", ["How-To Tutorial"]],
  ["7rHuRJ_1ZtI", ["Unboxing"]],
  ["JjVlxBKma6A", ["Unboxing"]],
  ["EMmKs8vMKhU", ["How-To Tutorial", "Unboxing"]],
  ["bCqnOn23LWE", ["Unboxing"]],
  ["hvkngQBVMW0", ["Unboxing"]],
  ["-7aSAWMUb6s", ["Unboxing"]],
  ["W0jOMHaEfzM", ["How-To Tutorial"]],
  ["2tsxIQZI3YQ", ["How-To Tutorial"]],
  ["yS6X0q4Nsws", ["Lookbook"]],
  ["olHYA5c6jl4", ["Lookbook"]],
  ["E7tN1jnho_g", ["Daily Routine"]],
  ["iUKlfDmEwNA", ["Daily Routine"]],
]);

const addGenres = new Map([
  ["P9JB-_RrBzs", ["Unboxing"]],
  ["ej9LJmaoS0g", ["Product Demo", "Feature Callout"]],
  ["9bgayvi_DzM", ["Product Demo", "Feature Callout"]],
  ["-ODcuQVfpMU", ["Macro Close-Up", "Multi-Angle / 360° Product Showcase", "Feature Callout", "Product Demo"]],
  ["X4T8XSjIfQw", ["TVC / Brand Commercial", "Feature Callout", "Product Demo"]],
  ["EIRZ-7Iaoe4", ["Product Demo", "Feature Callout", "Macro Close-Up"]],
  ["66X5Gnuw81w", ["Product Demo", "Macro Close-Up"]],
  ["6VVxPKrz6z0", ["Macro Close-Up"]],
  ["iUKlfDmEwNA", ["Macro Close-Up", "Multi-Angle / 360° Product Showcase", "Feature Callout"]],
  ["hvkngQBVMW0", ["TVC / Brand Commercial", "Macro Close-Up", "Feature Callout", "Product Demo"]],
]);

const records = source.records.map((record) => {
  if (record.status !== "accepted") return record;
  const removed = new Set(removeGenres.get(record.video_id) || []);
  const nextGenres = record.genres.filter((genre) => !removed.has(genre));
  for (const genre of addGenres.get(record.video_id) || []) {
    if (!nextGenres.includes(genre)) nextGenres.push(genre);
  }
  const changed = nextGenres.join("\u0000") !== record.genres.join("\u0000");
  return changed
    ? {
        ...record,
        genres: nextGenres,
        visual_notes: `${record.visual_notes.split("；成立题材：")[0]}；成立题材：${nextGenres.join("、")}；v3 题材标签按抽帧结构校正`,
      }
    : record;
});

const output = {
  ...source,
  version: 3,
  updated_at: new Date().toISOString(),
  revision_notes: [
    "按十点 storyboard 证据校正题材，去除仅凭标题推断的 How-To、Unboxing、Lookbook、Daily Routine",
    "补充画面明确展示充电动作、卖点标注或产品细节的 Product Demo、Feature Callout、Macro Close-Up",
    "对删除原错误标签后题材为空的 4 条接受母片，按可见结构补回 TVC、产品呈现或功能演示类标签",
    "保留原始 v2 文件作为审计对照，不改变 URL、商品品类、来源和接受状态",
  ],
  records,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

const accepted = records.filter((record) => record.status === "accepted");
const countBy = (category, genre) =>
  new Set(
    accepted
      .filter((record) => record.product_category === category && record.genres.includes(genre))
      .map((record) => record.canonical_master_id || record.video_id),
  ).size;

console.log(JSON.stringify({
  outputPath,
  changedRecords: records.filter((record, index) => record !== source.records[index]).length,
  categoryCounts: {
    "True Wireless / Bluetooth Earbuds": Object.fromEntries(
      source.criteria.target_genres.map((genre) => [genre, countBy("True Wireless / Bluetooth Earbuds", genre)]),
    ),
    "Power Banks": Object.fromEntries(
      source.criteria.target_genres.map((genre) => [genre, countBy("Power Banks", genre)]),
    ),
  },
}, null, 2));
