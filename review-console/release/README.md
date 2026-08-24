# AdGenie Review Console

独立部署的广告视频审核台。该目录由上游 AdGenie 工作区自动生成，不要直接编辑生成文件。

## 数据范围

- 完整审核状态：`web/data/creative-library-state.json`
- 三渠道交付：Ads of the World、Best Ads、STASH 的来源详情、媒体 API 与 Contact Sheet
- 视频资源：仅远程链接，不包含 MP4/MOV/WebM 文件
- 预览资源：仅包含表数据实际引用的联系表图片和允许内部联调的候选 Logo
- 来源证据：包含状态文件 `source_files` 声明的 JSON；发布副本中的本机绝对路径已替换为可移植占位符，原始证据保持不变
- 品牌治理：`collect/brand-normalization-map-v2.json`、`collect/brand-logo-catalog-v4.json`、`collect/runs/brand-governance-20260823/audit-report.json`、`collect/runs/brand-governance-20260823/record-risks.json`
- 品牌合同：`collect/brand-delivery-contract-v1.md`、`collect/brand-identity-contract-v1.md`、`collect/brand-logo-catalog-v4-contract.md`、`collect/brand-logo-methodology-v3.md`
- Logo 视觉门禁：`collect/runs/brand-logo-three-source-20260823/brand-assets/visual-review-gate.json`
- 完整性：`checksums.sha256` 覆盖发布包内除自身外的全部文件

## 本地验证

```bash
shasum -a 256 -c checksums.sha256
npm run build
npm start
```

默认地址：`http://127.0.0.1:4173`。

## 研发接入

- `GET /api/bootstrap`：获取完整审核台表数据。
- `GET /api/videos/:id/media`：获取当前播放地址、播放类型和下载能力；`media_playback_url` 指向该稳定 API。
- `POST /api/videos/:id/media`：强制刷新 Best Ads 等临时媒体链接。
- `GET /api/videos/:id/media/download`：直接文件或 progressive MP4 才会跳转；HLS-only 返回 `409 MEDIA_DOWNLOAD_NOT_AVAILABLE`，`media_download_url` 是下载尝试入口，不代表每条都有 MP4 文件。
- `GET /api/brand-governance/manifest`：获取候选品牌、身份和 Logo 治理信息。
- `GET /api/brand-governance/video-links`：获取每条三渠道广告到候选品牌的旁路关联。
- `GET /brand-logos/:candidate_brand_key.png?download=1`：下载仅限内部联调的候选 Logo。
- `GET /brand-logos-release/:brand_id.png`：仅提供 `approved_for_product=true` 且许可门禁通过的 Logo。

候选品牌和候选 Logo 均不代表人工确认或产品发布批准。当前 JSON 写入适合本地单人审核；多人持久审核需要接入数据库或对象存储。
