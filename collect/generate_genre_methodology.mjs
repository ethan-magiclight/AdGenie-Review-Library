import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(collectDir, "ad-video-genres-v1.json");
const outputPath = path.join(collectDir, "广告视频题材分类标准.md");

const taxonomy = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const groups = new Map(taxonomy.groups.map((group) => [group.code, group]));

const lines = [
  "# AdGenie 广告视频题材分类标准",
  "",
  `> 版本：v${taxonomy.version}（${taxonomy.updated_at}）`,
  "> 本文由 `ad-video-genres-v1.json` 生成。题材名称、定义或边界只在 JSON 单一事实源中修改，然后运行 `node collect/generate_genre_methodology.mjs`。",
  "> 本文只判断“内容是什么题材”；是否为品牌品宣、是否适合 AI 生成以及是否进入 MVP 核心模板库，按 `采集方案与优质判定标准.md` 独立审核。",
  "",
  "## 1. 分类原则",
  "",
  ...taxonomy.principles.map((principle) => `- ${principle}`),
  "",
  "### 主题材与次题材",
  "",
  "- `主题材`：最能代表用户观看预期和内容骨架的一个标签。内部复核必须先确定主题材。",
  "- `次题材`：视频中存在独立、连续、可指认的画面证据时才能增加；搜索词、标题词或单个瞬间不构成次题材。",
  "- 当前对外工作簿仍可只输出多标签列表，不新增用户未要求的展示字段；主题材仅用于内部复核和冲突裁决。",
  "- 一个母片在同一商品品类与同一题材中只计一次，不能因多标签、地区上传、语言版或长度剪辑重复计数。",
  "",
  "## 2. 分组",
  "",
  "| 分组 | 用途 |",
  "|---|---|",
  ...taxonomy.groups.map((group) => `| ${group.code} ${group.name} | ${group.description} |`),
  "",
  "## 3. 正式题材",
  "",
];

for (const group of taxonomy.groups) {
  lines.push(`### ${group.code} ${group.name}`, "");
  for (const genre of taxonomy.genres.filter((item) => item.group === group.code)) {
    lines.push(
      `#### ${genre.order}. ${genre.english}（${genre.chinese}）`,
      "",
      genre.definition,
      "",
      `- 成立证据：${genre.include_when}`,
      `- 排除边界：${genre.exclude_when}`,
      `- 检索语义：${genre.search_terms.map((term) => `\`${term}\``).join(" · ")}`,
      `- TopView 来源：${genre.topview_sources.map((source) => `\`${source}\``).join(" · ")}`,
      "",
    );
  }
}

lines.push(
  "## 4. 高频混淆裁决",
  "",
  "| 混淆组合 | 裁决问题 |",
  "|---|---|",
  "| TVC vs 其他题材 | TVC 是商业广告成片心智，可与产品、剧情或真人表达标签共存；品牌官方发布不自动等于 TVC。 |",
  "| Feature Callout vs How-To | 卖点、参数和利益点属于 Feature Callout；顺序操作、连接、设置和排错步骤属于 How-To。步骤文字不重复算卖点标注。 |",
  "| Product Demo vs How-To | Demo 回答“功能如何工作、结果是什么”；How-To 回答“我该按什么顺序完成任务”。 |",
  "| Macro Close-Up vs Multi-Angle | Macro 让观众看见微小材质和结构；Multi-Angle 让观众完整认识产品外观与方位。 |",
  "| Split-Screen vs Comparison Test | Split-Screen 是表现手法；Comparison Test 必须有统一条件、过程、结果和结论。二者可同时成立。 |",
  "| Try-On vs Lookbook | Try-On 强调单个用户穿戴或试用效果；Lookbook 强调系列搭配和整体风格。 |",
  "| Daily Routine vs 纪录片慢叙事 | Daily Routine 是紧凑、可复制的连续生活流程；人物背景慢铺垫、长期跟拍和产品弱露出属于纪录片表达，不进入核心模板。 |",
  "| UGC vs 来源类型 | UGC 是内容语法，不等于来源。品牌官方、创作者和演员都可能制作 UGC 风格内容，来源必须另行记录。 |",
  "| Talking Head vs Keynote | Talking Head 是单人正面对镜头；Keynote 有舞台、现场或正式演示关系。两者分类成立后仍要单独判断 AI 模板价值。 |",
  "",
  "## 5. 分类证据最低要求",
  "",
  "正式标签不能由查询词直接继承。每个标签至少需要一条可审计证据：",
  "",
  "1. 对应的连续时间段或代表帧。",
  "2. 说明该段画面为什么满足成立证据。",
  "3. 说明最接近的相邻题材为什么不是主题材，或为什么可以作为次题材共存。",
  "4. 无法获得足够画面、字幕或公开元数据时标为待复核，不提前写入正式题材。",
  "",
);

await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(outputPath);
