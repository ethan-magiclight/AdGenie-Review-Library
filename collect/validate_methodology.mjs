import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectDir = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFile(path.join(collectDir, name), "utf8");

const [taxonomyText, methodology, genreDoc, addScript, workbookScript] =
  await Promise.all([
    read("ad-video-genres-v1.json"),
    read("采集方案与优质判定标准.md"),
    read("广告视频题材分类标准.md"),
    read("add.py"),
    read("build_workbook_v8.mjs"),
  ]);
const taxonomy = JSON.parse(taxonomyText);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(taxonomy.status === "canonical", "题材 JSON 必须声明 canonical 状态");
assert(taxonomy.genres.length === 29, "正式题材必须正好为 29 个");

const groupCodes = new Set(taxonomy.groups.map((group) => group.code));
const englishLabels = taxonomy.genres.map((genre) => genre.english);
const orders = taxonomy.genres.map((genre) => genre.order);
assert(new Set(englishLabels).size === 29, "29 个英文题材标签必须唯一");
assert(new Set(orders).size === 29, "29 个题材序号必须唯一");
assert(
  orders.every((order) => Number.isInteger(order) && order >= 1 && order <= 29),
  "题材序号必须覆盖 1–29",
);

for (const genre of taxonomy.genres) {
  assert(groupCodes.has(genre.group), `题材分组不存在: ${genre.english}`);
  assert(genre.chinese, `缺少中文标签: ${genre.english}`);
  assert(genre.definition, `缺少定义: ${genre.english}`);
  assert(genre.include_when, `缺少成立证据: ${genre.english}`);
  assert(genre.exclude_when, `缺少排除边界: ${genre.english}`);
  assert(genre.search_terms.length > 0, `缺少检索语义: ${genre.english}`);
  assert(genreDoc.includes(genre.english), `生成文档缺少题材: ${genre.english}`);
}

const regressionIds = [
  "xa1LGVWoy30",
  "H1R_YQLiGzk",
  "a6zDDcGjFtM",
  "s2lowSj9k-s",
];
for (const videoId of regressionIds) {
  assert(methodology.includes(videoId), `主方法论缺少回归案例: ${videoId}`);
}

for (const blockedId of regressionIds.slice(0, 3)) {
  assert(addScript.includes(blockedId), `入库阻止列表缺少案例: ${blockedId}`);
}
assert(
  !addScript.includes('"https://www.youtube.com/watch?v=s2lowSj9k-s":'),
  "Belkin 正向回归案例不能加入阻止列表",
);
assert(
  addScript.includes("ad-video-genres-v1.json"),
  "入库脚本必须从题材事实源读取合法标签",
);
assert(
  workbookScript.includes("ad-video-genres-v1.json"),
  "工作簿生成脚本必须从题材事实源读取定义",
);
assert(
  !addScript.includes('"TVC / Brand Commercial"'),
  "入库脚本不能再硬编码题材集合",
);

const byName = new Map(taxonomy.genres.map((genre) => [genre.english, genre]));
assert(
  byName.get("How-To Tutorial").exclude_when.includes("不自动具备品牌品宣"),
  "How-To 必须明确分类成立不等于品牌品宣资格",
);
assert(
  byName.get("Feature Callout").exclude_when.includes("操作步骤"),
  "Feature Callout 必须排除操作步骤文字",
);
assert(
  byName.get("Daily Routine").exclude_when.includes("纪录片慢叙事"),
  "Daily Routine 必须排除纪录片慢叙事核心模板",
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      taxonomy_version: taxonomy.version,
      genre_count: taxonomy.genres.length,
      group_count: taxonomy.groups.length,
      regression_cases: regressionIds.length,
    },
    null,
    2,
  ),
);
