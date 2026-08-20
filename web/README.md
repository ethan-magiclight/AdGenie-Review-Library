# AdGenie Creative Library

内部品牌广告样片采集 / 分类 / 审核 / 状态标记平台。

第一版目标是把现有 `collect` 目录里的 v11 数据变成可本地启动、可团队共享查看的工作台：

- 按商品品类 × 广告题材查看样片覆盖矩阵；
- 在平台内预览 YouTube iframe、HTML5 MP4/HLS，并在失败时回退到 10 点 Contact Sheet；
- 视频列表字段可显示 / 隐藏；
- 可筛选商品品类、题材、状态；
- 状态筛选支持多选、包含已选、排除已选、全选、反选和清空；
- 可给视频标记状态；
- 可新增 / 删除自定义状态；
- 可拉黑错误视频；
- 可重归类商品品类和题材；
- 可写审核原因；
- 可把某条人工原因标记为“方法论候选线索”；
- 对缺少发布时间 / 时长的历史样片显示“元数据缺失”，避免把“看起来很老”写成不可审计规则；
- 方法论沉淀第一版只记录，不自动改规则。

## 启动

```bash
cd web
npm run import
npm run dev
```

默认访问：

```text
http://127.0.0.1:4173
```

如果要让同一局域网团队成员访问，可以指定 Host：

```bash
HOST=0.0.0.0 PORT=4173 npm run dev
```

然后让团队成员访问本机局域网 IP 的 `4173` 端口。

## 数据来源

`npm run import` 会读取：

- `collect/library-v9.json`
- `collect/consumer-electronics-review-v5.json`
- `collect/ad-video-genres-v1.json`
- `collect/consumer-electronics-taxonomy-v1.json`
- `collect/stats-v9.json`
- `collect/adgenie-brand-taxonomy-v1.json`
- `collect/采集方案与优质判定标准.md`
- `collect/采集方案与优质判定标准-v2.md`
- `collect/*contact-sheets*/manifest.json`

导入结果写入：

```text
web/data/creative-library-state.json
```

平台中的状态、重归类、拉黑、审核原因也会写回这个 JSON。

GitHub 首版默认不提交临时下载的原片和媒体缓存。审核台按媒体 provider 使用 YouTube iframe 或 HTML5 `<video>`；MP4/HLS 不可用时回退到 Contact Sheet，并保留来源详情页跳转。列表缩略图在本地 Contact Sheet 不存在时回退到来源缩略图。

## 视频链接刷新与研发接入

`GET /api/bootstrap` 会为可交付的 MP4/HLS 审核项动态补充两个字段，不会改写 `web/data/creative-library-state.json`：

- `media_resolver_url`：返回当前可播放/可下载地址、检查时间和失效时间的 JSON 接口。
- `media_download_url`：稳定下载入口；请求时解析当前媒体地址并以 `302` 跳转，调用方需要跟随重定向。

例如，研发可以直接执行：

```bash
curl -L -o video.mp4 'http://127.0.0.1:4173/api/videos/best_ads%3A185499%3A2227057d06/media/download'
```

审核台打开 Best Ads 侧边预览时会自动请求 `GET /api/videos/:video_id/media`；需要强制换新签名时，可请求 `POST /api/videos/:video_id/media` 或在页面点击“重新获取视频链接”。Best Ads 的 `token` 只保存在服务端内存缓存和当次 API 响应中，过期前 5 分钟自动换新，不写入审核数据；AOTW 等已有直接媒体地址的 provider 会立即返回现有地址。

Best Ads 刷新依赖浏览器访问服务，默认地址为 `WEB_ACCESS_PROXY=http://localhost:3456`，需要支持 `/targets`、`/new`、`/eval` 与 `/close`。服务不可用时接口返回 `503` 和明确原因，审核台继续展示 Contact Sheet，并保留重试和来源详情页入口。

## 重置数据

如果要从 `collect` 重新生成平台数据：

```bash
npm run reset:data
```

注意：这会用当前 `collect` 数据重新生成 `web/data/creative-library-state.json`，会覆盖平台里已有的人工标记。正式使用后应先备份该文件。

建议重置或批量修复前先运行：

```bash
npm run backup:data
```

## 维护命令

```bash
npm run build
npm run check
npm run validate:data
npm run backup:data
npm run repair:data
npm run backfill:metadata
npm run collect:validate
npm run collect:source:validate
npm run collect:best-ads -- --dry-run --max-list-pages 1 --max-details 1
npm run collect:aotw -- --dry-run --max-list-pages 1 --max-details 1
npm run collect:list:categories
npm run collect:list:genres
npm run collect:frames -- --input ../collect/runs/earbuds-latest.json
npm run collect:media:apply -- --self-test
npm run collect:canonical:link -- --self-test
```

- `npm run build`：部署前健康门禁；当前项目没有前端打包产物，会执行 `check + validate:data`。
- `npm run check`：检查前端、服务端和脚本语法。
- `npm run validate:data`：检查平台状态文件的结构、视频 ID、状态引用、审核事件和元数据缺口。
- `npm run backup:data`：把当前 `web/data/creative-library-state.json` 复制到 `web/data/backups/`。
- `npm run repair:data`：执行 P0 级状态修复，包括添加 `待补元数据` 系统状态、给缺 metadata 的视频打标、修复历史拉黑事件的 before 快照。
- `npm run backfill:metadata`：通过本机 `yt-dlp` 批量补齐 YouTube 发布时间和时长；会先自动备份当前状态文件，成功补齐后移除 `待补元数据`。
- `npm run collect:validate`：检查 34 个商品品类、29 个题材、Top 品牌、官方账号和采集策略是否一致。
- `npm run collect:source:validate`：检查双站来源合同、新行业 taxonomy 与来源分类候选映射。
- `npm run collect:best-ads` / `collect:aotw`：可断点、dry-run、限速、幂等的 Campaign 视频采集入口；单轮硬限制 500 个详情页 / 360 分钟。
- `npm run collect:list:categories` / `collect:list:genres`：列出采集器可以直接切换的品类和题材。
- `npm run collect:frames -- --input <批次>`：下载候选低清视频并按原画幅生成 10 帧 Contact Sheet；默认不使用浏览器 Cookie。
- `npm run collect:media:apply`：把真实抽帧结果、失败原因、媒体状态和可选指纹幂等回写来源记录；短效签名 URL 保持 `temporary`。
- `npm run collect:canonical:link`：用强媒体证据分配资产级 `canonical_master_id`，合并跨站同母片的 `source_refs[]`，并分开关联剪辑/画幅变体。

## 当前预置状态

系统预置状态：

- 待审核
- 需复刻
- 已复刻
- 暂搁置
- 待补元数据
- 已入库
- 已排除
- 已拉黑

其中系统状态不可删除；你可以在“状态管理”页新增 / 删除自定义状态。

## 字段显示控制

在“视频审核”页点击右上角“字段显示”，可以控制列表字段显示 / 隐藏。
当前第一版字段偏好保存在浏览器 `localStorage`，不会影响其他团队成员。

## 元数据缺失处理

历史库 `library-v9` 中有一批视频缺少 YouTube metadata，平台会显示为“元数据缺失”。
遇到这类视频时，不建议直接写“看起来很老”。推荐先记录：

- `METADATA_MISSING`：缺少发布时间或时长，无法执行年代 / 时长审核门。
- `VISUAL_OUTDATED_SUSPECTED`：视觉语言疑似过旧，但需要补元数据后确认。

补到明确发布时间或时长后，再使用更确定的规则：

- `OUTDATED_PRODUCT_OR_VISUALS`
- `DURATION_OUT_OF_RANGE`

人工集中审核前建议先执行：

```bash
npm run backfill:metadata
npm run validate:data
```

如果只想小批量验证：

```bash
npm run backfill:metadata -- --limit 10
```

如果 YouTube 返回 bot 校验，可以显式使用本机 Chrome 登录态：

```bash
npm run backfill:metadata -- --cookies-from-browser chrome
```

这会读取本机 Chrome Cookie 供 `yt-dlp` 请求 YouTube 使用；Cookie 不会写入项目文件或提交到 Git。

## 方法论沉淀策略

第一版不做自动化方法论更新。

人工审核时可以勾选“记录为方法论候选线索”。这些记录会出现在“方法论记录”页，后续可由 Codex 批量分析，再人工决定是否更新：

- `collect/采集方案与优质判定标准.md`
- `collect/采集方案与优质判定标准-v2.md`
- 采集 / 分类脚本规则

Best Ads 与 Ads of the World 的渠道采集进度、范围、排除规则、媒体交付策略和续跑前置条件，以 `collect/source-collection-methodology-v1.json` 为单一事实源。每次扩大渠道范围前必须先更新目标，完成后再更新进度并运行：

```bash
npm run backup:data
npm run methodology:sync
```

## 增量采集与导入

新的活动采集入口是 `collect/collect-latest.mjs`。例如：

```bash
npm run collect:latest -- \
  --category "True Wireless / Bluetooth Earbuds" \
  --genres "TVC / Brand Commercial,Feature Callout,Product Demo" \
  --formats "shorts,videos" \
  --days 365 \
  --search-all-brands \
  --official-only \
  --output ../collect/runs/earbuds-latest.json
```

采集结果不会直接进入页面，因为搜索题材只能作为召回证据。候选必须先完成下载、10 点抽帧、内容性质判断和正式题材分类，再执行：

```bash
npm run ingest:candidates -- --file ../collect/runs/earbuds-reviewed.json --dry-run
npm run ingest:candidates -- --file ../collect/runs/earbuds-reviewed.json
```

导入脚本会按平台 ID、规范 URL 和母片 ID 检查历史重复，并拒绝 `pending_visual_review` 或没有正式 `genres` 的候选。

Best Ads / AOTW 使用独立的候选审核导入器。一个 Campaign 的每个视频会成为一条审核项，但共享 `campaign_id`；来源分类、Campaign published、source Uploaded、Agency、媒体状态与 AdGenie 候选分类都会保留。AI 视觉预审不会写正式题材：

Best Ads 页面只有 `Uploaded` 时，审核台“发布时间”显示该来源收录日期，同时保留 `publish_date_source=source_uploaded_only` 和 `publish_date_confidence=unverified`；不会把它伪装成已核实的 Campaign 首发日期。历史 Best Ads 数据可在备份后执行 `npm run backfill:best-ads-dates` 回填。

Best Ads / AOTW 完成 AI 视觉预审后，导入器会把全部题材候选初始化到 `genres`，把置信度最高的一项写入 `primary_genre`，其余写入 `secondary_genres`。记录仍保持 `pending_review`、`approved=false` 和 `core_template_eligible=false`，默认题材必须在审核台人工确认或纠正。历史双站数据可在备份后执行 `npm run backfill:source-genres` 回填。

```bash
npm run ingest:source-records -- --file ../collect/runs/aotw-film-2025-2026/reviewed-records.json --dry-run
npm run backup:data
npm run ingest:source-records -- --file ../collect/runs/aotw-film-2025-2026/reviewed-records.json
npm run validate:data
```

真实写入前，导入器强制要求存在一个 mtime 不早于当前 `creative-library-state.json` 的 backup；否则直接失败且不改状态文件。缺品牌、未完成 10 帧视觉预审，或既无可播放定位也无 Contact Sheet 的资产只记明确 skip reason，不生成审核项。所有新项只带 `pending_review`（缺 Campaign date/时长时同时带 `metadata_missing`），并强制 `genres=[]`、`approved=false`、`core_template_eligible=false`。重复执行新增重复记录应为 0。

推荐先执行媒体回写和双站母片链接，再把 linked records 交给导入器。`canonical_master_id` 以视频资产为粒度；同 Campaign 多视频不会被错误压成一个母片。只做 dry-run 时不会要求 backup，也不会改人工状态文件。

## 部署注意

当前服务使用本地 JSON 文件作为运行状态存储，适合单人或低并发内网使用。
如果要多人长期共享审核，建议升级到 SQLite / Postgres，并增加登录鉴权、并发写入保护和自动备份。

当前形态不适合直接部署到 GitHub Pages，因为平台需要 API 写入状态。

如果部署平台需要命令配置：

```bash
Build Command: npm run build
Start Command: npm run start
```
