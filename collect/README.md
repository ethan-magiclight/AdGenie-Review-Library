# 品牌广告样片采集工作区

## 当前单一事实源

| 文件 | 角色 |
|---|---|
| `采集方案与优质判定标准.md` | **主方法论**：采集目标、审核门、核心模板资格、失败模式、回归案例和维护流程 |
| `ad-video-genres-v1.json` | **题材单一事实源**：29 个正式题材、分组、定义、成立证据、排除边界、检索语义和 TopView 映射 |
| `广告视频题材分类标准.md` | 由题材 JSON 生成的内容团队可读版本，不直接编辑 |
| `consumer-electronics-taxonomy-v1.json` | 消费电子 34 个目标商品品类、定义、边界和检索路径 |
| `industry-top-brands-v2.json` | 34 个商品品类的 Top 品牌与产品线；切换品类时由采集器直接读取 |
| `pet-supplies-taxonomy-v1.json` | 宠物用品商品品类、定义、边界和检索路径；不按狗/猫作为一级品类 |
| `pet-supplies-top-brands-v1.json` | 宠物用品 Top 品牌与产品线；不能与消费电子品牌池混用 |
| `platform-source-registry-v1.json` | 已人工验证的官方账号、频道 ID、支持形态与验证日期 |
| `collection-policy-v1.json` | 日期、时长、画幅、评分、去重、来源与视觉审核门禁的版本化规则 |
| `pet-supplies-collection-policy-v1.json` | 宠物用品采集与视觉审核门禁；产品证据包含宠物使用过程和使用结果 |
| `source-video-record-contract-v1.json` | Best Ads / Ads of the World Campaign、来源、双日期、媒体资产与待补状态合同 |
| `adgenie-brand-taxonomy-v1.json` | Apparel & Footwear、Beauty & Personal Care、Food & Beverage、Home & Living/Household 的新增 taxonomy |
| `source-category-mapping-v1.json` | 来源分类到 AdGenie 候选分类的置信度、证据和待人工确认分支 |
| `visual-pre-review-contract-v1.json` | AI 视觉预审候选字段；禁止直接写正式题材、批准或核心模板资格 |
| `report-source-batch.mjs` | 双站批次的品牌、日期、视频、抽帧、分类、去重和排除原因只读报告 |
| `采集方案与优质判定标准-v2.md` | 消费电子 MVP 专项补充；只记录专项范围和额外约束，不复制完整主规则 |

生成可读题材文档：

```bash
node collect/generate_genre_methodology.mjs
```

题材名称或定义变化时，只修改 `ad-video-genres-v1.json`，然后重新生成 Markdown。入库校验和后续工作簿生成也必须读取同一 JSON，不能在脚本中再维护一份题材常量。

## 数据与历史快照

| 文件 | 内容 |
|---|---|
| `library-v7.json` / `stats-v7.json` | v9 工作簿使用的数据快照；包含尚未按 2026-08-01 新门禁全量重审的历史记录 |
| `consumer-electronics-review-v3.json` | 上一轮消费电子局部题材修正；不是全量视觉重审结果 |
| `library-v6.json` 及更早版本 | 历史快照，保留审计，不再作为新的方法论事实源 |
| `mvp-candidates-*.json` / `mvp-frame-review-v1.json` | 搜索召回、硬过滤和抽帧过程数据；`frames_reviewed` 只表示获得帧，不等于完成语义审核 |

`AdGenie能力需求表-v9.xlsx` 是历史输出，不应再把其中 129 条消费电子候选解释为已经通过新方法论的核心模板。全量重审完成前，数量只反映旧规则下的候选关系。

`build_consumer_electronics_v2.mjs` 与 `revise_consumer_electronics_v3.mjs` 已标记为历史审计脚本，默认拒绝运行。它们分别存在“搜索题材直接写正式标签”和“按视频 ID 打补丁”的已知缺陷。

`discover_mvp_gap_candidates_v1.mjs`、`enrich_gap_candidates_v1.mjs` 和同批次 gap 文件保留作历史审计，不再作为新的活动采集入口。新采集统一使用 `collect-latest.mjs`。

## 核心决策链

```text
搜索召回
→ 链接与发布者真实性
→ 内容性质：品宣 / 支持教程 / 发布会 / 测评 / 纪录片等
→ 年代与产品代际
→ 题材独立分类
→ AI 可生成性与生成价值
→ 核心模板资格
→ 母片去重与计数
```

铁律：

- 搜索查询绑定的题材只能用于召回，不能直接写入正式 `genres`。
- 品牌官方来源不等于品牌品宣广告；官方支持教程分类可以成立，但默认不进入 MVP 核心模板库。
- 题材标签服务于行业和用户成熟心智，可以多标签；每个标签都必须有独立画面证据。
- 分类成立不等于模板资格成立。年代、内容性质和 AI 生成价值必须独立审核。
- 10 点抽帧必须产生实际视觉判断，不能只记录帧数量。
- 不为每格凑满 10 条降低标准；缺口如实保留。

## 统一增量采集

列出可切换的商品品类和广告题材。默认 policy 是消费电子；其他行业必须显式指定 `--policy`：

```bash
node collect/collect-latest.mjs --list-categories
node collect/collect-latest.mjs --list-genres
node collect/collect-latest.mjs --category "True Wireless / Bluetooth Earbuds" --list-brands
node collect/collect-latest.mjs --policy pet-supplies-collection-policy-v1.json --list-categories
node collect/collect-latest.mjs --policy pet-supplies-collection-policy-v1.json --category "Pet Food & Treats" --list-brands
```

## Best Ads 与 Ads of the World 视频源

两个来源使用 `source-video-record-v1` 合同，不与 YouTube 官方账号采集混写。列表页只发现稳定 ID，详情页补品牌、Campaign published、来源 Uploaded、分类和视频资产；原始标签保留在 `raw_source`，不会被 AdGenie 候选分类覆盖。

2026-08-19 一手页面核对：Best Ads 美国 / TV / Cosmetics & toiletries 全历史为 412 条，其中来源 year filter 2025 为 14、2026 为 17；该 year filter 与详情 Uploaded 都只作为来源收录时间，不能当 Campaign 作品年份。AOTW 官方 Film 页为 29,702 Campaigns / 496 页；只用详情正文的 Campaign published month/year 判断 2025/2026。

合同、taxonomy、映射与反向验证：

```bash
node collect/validate-source-records.mjs --self-test
node collect/validate-source-records.mjs --file collect/runs/aotw-film-2025-2026/records.json
```

双站入口均支持 `--phase discover|details|all`、`--dry-run`、限速、重试和原子 checkpoint；代码硬限制单轮最多 500 个详情页、360 分钟：

```bash
cd web
npm run collect:best-ads -- --phase all --max-details 500 --max-runtime-minutes 360
npm run collect:aotw -- --phase all --max-details 500 --max-runtime-minutes 360
```

每批完成后输出可审计统计；Contact Sheet 未运行时不传 `--contact-sheets`，抽帧成功率将为 `null`：

```bash
node collect/report-source-batch.mjs \
  --records collect/runs/best-ads-2025-2026/records.json \
  --checkpoint collect/runs/best-ads-2025-2026/checkpoint.json \
  --contact-sheets collect/runs/best-ads-contact-sheets-sample-20/manifest.json \
  --output collect/runs/best-ads-2025-2026/batch-report.json
```

Best Ads 范围固定为 United States of America、TV、2025/2026 与九个指定来源分类。AOTW 不限国家/Industry，但必须 Campaign published 为 2025/2026、Medium types 含 Film、至少一个真实视频；Student、无视频与年份越界只记 outcome，不生成审核项。重复运行按 source record / media asset key 幂等，不重复新增。

AI 视觉预审写入媒体资产下的 `ai_visual_pre_review`，只允许行业、商品品类和题材候选：

```bash
node collect/apply-visual-previews.mjs --self-test
node collect/apply-visual-previews.mjs \
  --records collect/runs/aotw-film-2025-2026/records.json \
  --reviews collect/runs/aotw-film-2025-2026/visual-reviews.json \
  --output collect/runs/aotw-film-2025-2026/reviewed-records.json \
  --reviewed-only
```

每个 completed review 必须有真实 10 帧 Contact Sheet 证据、内容性质、商品主体、行业/品类候选、题材候选、四段广告结构、视觉质量和模板价值。合并器强制保持 `genres=[]`、`approved=false`、`core_template_eligible=false`。

Contact Sheet manifest 必须先通过媒体回写器；成功项写入真实时长、尺寸、画幅、访问时间与 Contact Sheet，失败项保留原因。Best Ads 短效签名媒体保持 `access_status=temporary`，不会因抽帧成功被伪装成永久可用。抽帧器的新批次还会在删除临时视频前记录内容 SHA-256 与 10 帧 `dhash-9x8-v1` 指纹：

```bash
node collect/apply-media-manifest.mjs --self-test
node collect/apply-media-manifest.mjs \
  --records collect/runs/aotw-film-2025-2026/reviewed-records.json \
  --manifest collect/runs/aotw-contact-sheets/manifest.json \
  --output collect/runs/aotw-film-2025-2026/media-reviewed-records.json
```

双站母片链接只用稳定 provider ID、相同内容 SHA，或同品牌且时长、画幅与 10 帧指纹完全一致的强证据自动合并。近似视觉不自动合并；不同长度或画幅分别写 `alternate_cut` / `alternate_aspect_ratio`，其余进入 `pending_canonical_review`：

```bash
node collect/link-canonical-masters.mjs --self-test
node collect/link-canonical-masters.mjs \
  --file collect/runs/best-ads-2025-2026/media-reviewed-records.json \
  --file collect/runs/aotw-film-2025-2026/media-reviewed-records.json \
  --output collect/runs/best-ads-aotw/records.json
```

采集指定品类、题材与平台形态：

```bash
node collect/collect-latest.mjs \
  --category "True Wireless / Bluetooth Earbuds" \
  --genres "TVC / Brand Commercial,Feature Callout,Product Demo,Daily Routine" \
  --formats "shorts,videos" \
  --brand-tier "P0,P1" \
  --days 365 \
  --search-all-brands \
  --official-only \
  --output collect/runs/earbuds-latest.json
```

宠物用品采集必须使用宠物用品 policy，不允许只把消费电子命令里的品类改名：

```bash
node collect/collect-latest.mjs \
  --policy pet-supplies-collection-policy-v1.json \
  --category "Pet Food & Treats" \
  --genres "TVC / Brand Commercial,Problem–Solution,Daily Routine,Feature Callout,Before & After" \
  --formats "shorts,videos" \
  --brand-tier "P0,P1" \
  --days 730 \
  --search-all-brands \
  --official-only \
  --output collect/runs/pet-food-latest.json
```

如果 YouTube RSS 或详情页元数据受限，允许先扩大人工候选池，但必须显式标记为待补发布时间：

```bash
node collect/collect-latest.mjs \
  --policy pet-supplies-collection-policy-v1.json \
  --category "Pet Tech & Smart Devices" \
  --genres "TVC / Brand Commercial,Problem–Solution,Product Demo,Feature Callout,How-To Tutorial" \
  --formats "shorts,videos" \
  --brand-tier "P0,P1" \
  --days 730 \
  --search-all-brands \
  --official-only \
  --max-metadata-fetches 0 \
  --allow-pending-publish-date \
  --output collect/runs/pet-tech-top-brand-candidates-pending-date.json
```

`--allow-pending-publish-date` 只表示“先给人工审核一个待补元数据候选池”，不表示通过年代门，也不能导入正式模板库。宠物用品尤其要避免把 15 秒短广告、官方支持教程、清洁维护、安装设置、配件升级包和单纯萌宠内容当成品牌品宣样片。

执行前先验证整套配置：

```bash
node collect/validate-collection-system.mjs
node collect/validate-collection-system.mjs --policy collection-policy-v1.json --policy pet-supplies-collection-policy-v1.json
```

采集器按以下顺序工作：

```text
读取品类、题材、Top 品牌、官方账号和规则版本
→ 官方账号 Shorts / Videos 直采
→ 品牌 × 产品线 × 题材定向补漏
→ RSS 精确发布时间与公开元数据补齐
→ 平台 ID、规范 URL、母片 ID 全历史去重
→ 来源、近期性、商品相关、广告意图和互动的发现优先级评分
→ 输出独立候选批次
→ 10 点抽帧、内容性质、产品主体、广告结构和制作质量审核
→ 通过导入门禁后进入页面复核
```

`discovery_score` 只代表候选发现优先级，不是广告质量；官方来源、发布时间或 9:16 画幅都不能单独证明优质。`recall_genres` 只记录本次用于召回的题材。采集结果中的正式 `genres` 保持为空，必须完成 10 点抽帧、内容性质和题材视觉判断后才能导入页面。

导入器会强制检查 `visual_review`：内容必须属于品牌商业广告、产品 campaign 或广告化产品片；Hook、商业命题、产品证明和品牌收束四段结构均成立；视觉质量分至少 72；并且必须有 Contact Sheet。消费电子产品相关画面至少占 50%；宠物用品按产品本体、包装、主人操作、宠物使用过程、使用结果、明确卖点字幕和品牌收束合并判断，不能只因宠物可爱就算产品证据。新增记录统一进入 `pending_review`，视觉预审不会替代最终业务审核。

通用抽帧入口直接读取新候选批次，并按横屏、竖屏或方形原始画幅生成 10 帧 Contact Sheet：

```bash
python3 collect/build-contact-sheets.py \
  --input collect/runs/earbuds-latest.json
```

默认不读取浏览器 Cookie。脚本支持 YouTube、Vimeo、MP4、HLS、AOTW CDN 与 Best Ads 签名 MP4；Best Ads 的短效签名只通过 web-access CDP Proxy 在内存中刷新，不把 query token 写入记录。成功或失败都会删除低清中间视频，只保留帧、Contact Sheet、manifest 和失败原因，不提供永久保留原片选项。如果 YouTube 明确需要登录，应由操作者决定是否使用 `--cookies-from-browser chrome`，Cookie 不会写入项目文件。`--provider` 可只处理指定 provider，`--offset` 可从过滤后的资产序号续跑，避免重复下载已完成样本。

2026-08-12 宠物用品试点输出：

| 文件 | 结果 | 状态 |
|---|---:|---|
| `collect/runs/pet-food-top-brand-candidates-pending-date-2026-08-12.json` | 3 条候选 | 均为 `publish_date_missing`，待补发布时间和抽帧 |
| `collect/runs/pet-tech-top-brand-candidates-pending-date-2026-08-12.json` | 13 条候选 | 均为 `publish_date_missing`，待补发布时间和抽帧 |

对应 Contact Sheet manifest 已生成，但当前 YouTube 下载触发 bot 校验，`ok_count = 0`。这些候选只能作为“链接候选 / 人工预览入口”，不能计入正式样片覆盖。

每周运行 P0 品牌增量采集；每月检查账号失效、误召回率、9:16 占比和品类缺口；每季度调整 Top 品牌层级和产品线。账号必须写入频道 ID、验证日期和账号类型，不能只凭显示名称认定官方来源。

## 入库

```bash
python3 collect/add.py << 'JSON'
[{"industry":"...","brand":"...","title":"...","url":"...","genres":["..."],"source_type":"品牌官方","note":"..."}]
JSON
```

`add.py` 从 `ad-video-genres-v1.json` 读取合法题材，从消费电子商品分类 JSON 读取合法商品品类，并阻止已确认不适合作为核心模板的回归案例重新入库。

## 修改规则

1. 新认知先写入主方法论，说明它影响哪个审核门。
2. 涉及题材名称、定义或边界时，只修改题材 JSON，并重新生成题材 Markdown。
3. 每个导致规则变化的错误案例都要加入主方法论回归表；能够自动断言的同时加入校验脚本或阻止列表。
4. 修改代码后执行最快相关检查：JSON 解析、29 题材唯一性、脚本语法和回归案例。
5. 旧工作簿不覆盖；完成全量重审后再生成新版本工作簿。
6. 日期、画幅、来源、评分或去重规则只修改 `collection-policy-v1.json`；品牌与账号分别只修改对应注册表，并同步升级 `rule_version`。

方法论自检：

```bash
node collect/validate_methodology.mjs
node collect/validate-collection-system.mjs
```
