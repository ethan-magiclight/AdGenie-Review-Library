# AdGenie 品牌与 Logo 研发交付合同 v1

## 目标与范围

本合同只覆盖 Ads of the World、Best Ads、STASH。历史 YouTube 不进入当前品牌交付。品牌治理、Logo 资产和审核台正式状态相互隔离；任何候选映射或候选 Logo 都不得覆盖 `review_status`、`approved`、`core_template_eligible`、人工备注或审核事件。

## 三层状态

1. `identity_resolution`：原始品牌 claim 是否属于某个标准品牌身份。
2. `record_role_resolution`：该品牌在具体广告中是主品牌、联合品牌、产品线、母品牌、广告主还是地区实体。
3. `logo_asset_review`：Logo 来源、质量、文件完整性、许可和产品批准状态。

三层状态不得互相自动晋级。下载到图片不代表身份已确认；身份已确认不代表 Logo 已通过视觉或许可审核；Logo 文件技术可用不代表获准产品发布。

## 交付包

研发包必须包含：

- `manifest.json`
- `brands.json`
- `video-brand-links.json`
- `assets/preview/*.png`
- `assets/release/*.png`
- `provenance/audit-report.json`
- `provenance/record-risks.json`
- `checksums.sha256`
- `README.md`

`assets/preview` 只用于内部研发联调和人工复核。`assets/release` 只能包含 `approved_for_product=true` 的资产。`express_permission_required` 资产不能进入任何交付资产目录。

## 品牌字段

未经确认的身份只能使用 `candidate_brand_key`，正式 `brand_id` 必须为 `null`。只有 `source_verified` 或 `human_confirmed` 身份才能获得正式 `brand_id`。原始 `raw_brand`、`raw_primary_brand`、来源详情页、映射方法、风险代码和人工复核状态必须保留。

## Logo 字段

每个 Logo 候选至少包含：

- `status`
- `source_kind`
- `preview_asset_path`
- `release_asset_path`
- `mime`
- `bytes`
- `width` / `height`
- `sha256`
- `permission_status`
- `approved_for_product`
- `usage_scope`
- `policy_note`

标准输出必须为真实可解码的 224×224 PNG，文件 SHA-256、字节数和尺寸必须与 manifest 一致。禁止保存 Cookie、Token、签名 URL、短效地址或第三方图库伪装成官方来源。

## 持续新增流程

新广告进入后按以下顺序处理：

1. 生成只包含三渠道的品牌输入快照并记录 state SHA-256。
2. 保留原始品牌 claim，生成 identity candidate 和记录角色候选。
3. 处理人工风险队列；`proposed` 不得直接进入 Logo 发布。
4. 身份证据优先级：官方品牌规范或媒体包、品牌官网、母公司正式品牌页、官方账号、已审核广告画面。
5. Logo 采集按有界批次运行，逐品牌 checkpoint，保留错误、尝试次数和稳定来源。
6. 运行尺寸、MIME、SVG 安全、哈希、许可和引用完整性校验。
7. 原子生成版本化交付包；生成前后正式 state SHA-256 必须一致。

## 验收

- 恰好包含三渠道全部广告，每个 `video_id` 唯一。
- Ads of the World、Best Ads、STASH 数量与正式 state 一致。
- 每个品牌引用都能解析到候选品牌目录；无法确认的记录保留明确原因。
- 每个 Logo 文件存在、可解码、尺寸和哈希一致。
- `preview` 与 `release` 严格隔离；未批准资产不进入 `release`。
- 包内不包含敏感凭证、短效 URL 或路径穿越。
- 正式 state、人工状态和审核事件在打包前后不变。
