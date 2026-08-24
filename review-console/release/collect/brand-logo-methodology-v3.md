# AdGenie 全量品牌 Logo 获取与维护方法论 v3

更新日期：2026-08-22

## 1. 目标和事实边界

本流程服务于审核台 853 条模板视频。品牌 Logo 只绑定 `canonical_brand_id`，不直接绑定审核台原始 `brand` 字符串。当前归一结果为 329 个原始品牌值、269 个标准品牌；4 条无品牌视频被明确标记为非品牌主体，不伪造品牌。

Logo 资产的三个事实层必须分开：

1. `brand-normalization-map-v1.json`：视频、原始品牌值与标准品牌的映射事实。
2. `brand-official-site-registry-v3.json`：标准品牌身份与官网或广告兜底来源的证据。
3. `brand-assets-v3/registry.json`：实际下载、处理、哈希、尺寸、质量、权限和审批状态。

“找到官网”“下载到图片”“可以在产品中展示”是三个不同状态，禁止合并判断。

## 2. 品牌映射归一

### 2.1 归一键

- 以小写 ASCII slug 作为 `canonical_brand_id`，显示名保留品牌官方大小写与符号。
- 地区账号、频道后缀、大小写和官方支持账号归并，例如 `SHISEIDO_USA → Shiseido`。
- 联名广告拆成多个标准品牌，例如 `Doritos x Netflix` 同时映射 Doritos、Netflix。
- 母公司字段只在广告实际宣传子品牌时映射到子品牌，并保留原始值作为审计证据。
- 制片公司、代理商、创作者、数据错误占位符不当作品牌；无品牌记录保留空数组和原因。

### 2.2 同名品牌校验

自动域名命中只用于发现候选，不足以完成身份确认。必须同时核对：

- 审核台广告标题、行业、产品和国家；
- 官网标题、结构化数据、域名和产品内容；
- 母品牌/子品牌关系；
- 是否为同名企业、零售商、仿冒站或历史品牌。

本批次发现并纠正的典型错误包括：ESR 配件品牌与 ESR 地产资管、Native 个护与 Native Design、Rennie 药品与加拿大地产、Shark 家电与 Greg Norman 服饰、Extra 口香糖与 Extra TV、FirePower 能量饮料与 Global Firepower。

人工判定写入 `brand-official-site-overrides-v3.json`，不能只修改生成结果。无可靠官网的 6 个小品牌写入 `brand-campaign-logo-fallbacks-v3.json`，保留审核台广告页、原视频 URL、建议截帧时间和判定说明。

这里必须区分“品牌身份来源”和“Logo 资产来源”：当前 263 个标准品牌有官方身份页，6 个品牌只能由审核台广告证据确认身份；Logo 资产层共有 10 个 `campaign_frame_derived`，其中除上述 6 个外，City Centre、Coors Light、DICK'S Sporting Goods、Kit Kat 虽有官方身份页，但官方页面没有提供可用的精确品牌 Logo，因此采用已复核广告片画面作为资产兜底。

## 3. Logo 来源优先级

按以下顺序选择，找到高质量来源后停止降级：

1. 品牌官方 Brand Guidelines、Press Kit、Media Kit、Newsroom 或 Trademark Resources 的当前 SVG/PNG。
2. 品牌官网当前页头、页脚、结构化数据或页面明确引用的 Logo 文件。
3. 母公司官网的正式子品牌页，例如 Sprite、Minute Maid、REESE'S。
4. 品牌官方社交账号的头像，仅限账号身份已由官网或广告证据确认且没有更高质量来源。
5. 审核台已验证的品牌广告品牌帧裁切；仅用于没有可靠官网/媒体包，或官方页面无法取得精确子品牌 Logo 的例外，必须标记 `campaign_frame_derived`，并保留视频、时间码和裁切框。

Simple Icons、Wikimedia、品牌百科和零售商只能帮助发现或交叉核对，不能单独作为最终来源。生成式 AI、手工描摹、字体重打和凭印象重画均禁止。

## 4. 自动采集与证据

`discover-brand-official-sites-v3.mjs` 负责身份来源：

- 优先使用既有官方来源与人工覆盖；
- 尝试直接域名和搜索候选；
- 记录页面标题、canonical URL、站点名、JSON-LD 名称、匹配分数和候选列表；
- 低分、同名或第三方命中停在人工复核，不自动下载；
- 每个品牌完成后写检查点，任务中断可重试。

`collect-brand-official-logos-v3.mjs` 负责资产：

- 从官方页面读取 Apple Touch Icon、高分辨率 icon、JSON-LD logo、明确 Logo 图片和 favicon；
- 从官方页面发现 CDN URL 时，同时保存官网页和最终 CDN URL；
- 保存 MIME、字节数、像素、SHA-256、采集日期和失败尝试；
- SVG 先做安全检查，再产生展示文件；
- 所有资产默认 `approved_for_product=false`。

自动解析出的 Logo 若是母公司、联合品牌或错误锁定版本，必须在 `brand-official-asset-overrides-v3.json` 写入精确的官方资产 URL，再重新采集；不允许直接修改生成的登记表掩盖错误。Shark 等需要精确子品牌版本的资产采用这一层覆盖。

对 JavaScript 渲染、反爬或仅在页面视觉层展示 Logo 的官网，运行 `collect-brand-rendered-page-logos-v3.mjs`，由无头浏览器打开已验证的官方页面、定位明确的 Logo 元素并高倍截图。登记表必须保存最终 URL、页面标题、元素信息、原始截图和哈希；该路径标记为 `official_asset_rendered_from_official_page_pending_approval`，不能伪装成官网直接下载的原文件。

若官方来源只能提供小于 128px 的位图，完整尝试媒体包、精确资产覆盖和页面渲染后，才允许由 `finalize-brand-low-resolution-fallbacks-v3.mjs` 转入 `official_asset_low_resolution_fallback_pending_approval`。它表示来源可信、可供审核预览，但不是高质量官方母版。本批次共有 14 个此类兜底资产。

自动任务使用独立 HTTP 客户端，不操作用户浏览器，不触发下载弹窗。

## 5. 格式与尺寸标准化

### 5.1 原始文件

- 优先 SVG，其次透明 PNG/WebP，再次高分辨率 JPG；ICO 和低分辨率 favicon 只作证据或临时预览。
- SVG 禁止 `<script>`、`foreignObject`、iframe、对象嵌入、事件处理器和外部可执行内容。
- 原始文件不改轮廓、不改字形、不拉伸，保存原始比例和哈希。
- 位图最长边小于 128px 标记 `quality_upgrade_required`，不得因放大到 224px 就视为合格。

### 5.2 统一输出

- 输出：透明背景 sRGB PNG，固定 224×224px。
- 安全内容框：最大 184×184px，四周至少 20px 透明空间。
- 产品建议显示：56×56 CSS px，`object-fit: contain`。
- Symbol、Wordmark、Combination Mark 保持官方比例；统一的是容器，不是 Logo 自身长宽比。
- 不自动反色、单色化、裁切注册符号或重新排版。

### 5.3 视觉验收

在 `brand-logo-review-v3.html` 中检查：

- 品牌主体和版本正确；
- 图形不是网站 favicon、产品图、活动图或母公司 Logo；
- 白底、深色背景和 56px 实际显示下可识别；
- 无拉伸、过度留白、锯齿、错误透明边缘和颜色漂移；
- Wordmark 不被强制塞成方形 Symbol。

## 6. 状态与权限

资产状态最少包含：

- `pending_asset_collection`：官网已确定，资产未采集。
- `official_asset_collected_pending_approval`：官方资产和标准化预览已生成，待视觉/法务审核。
- `official_asset_collected_quality_upgrade_required`：来源正确但位图低于质量下限。
- `asset_collection_needs_review`：官网未暴露可用 Logo 或候选全部失败。
- `asset_collection_network_retry_required`：TLS、超时、限流等网络故障，品牌身份不回退，恢复后自动重试。
- `pending_campaign_frame_collection`：无官网品牌等待从审核台广告提取末帧。
- `campaign_frame_collected_pending_crop_review`：候选末帧已保存，等待人工选择时间码和精确裁切框。
- `official_asset_collected_permission_blocked`：文件存在但明确需要额外商标许可。
- `official_asset_rendered_from_official_page_pending_approval`：来自已验证官网的页面元素渲染截图，待视觉/法务审核。
- `official_asset_low_resolution_fallback_pending_approval`：官方来源可信但原始分辨率低于质量目标，作为已披露的审核兜底。
- `campaign_frame_derived_pending_approval`：从已验证广告片品牌帧裁切，已记录视频、时间码和裁切框，待视觉/法务审核。
- `approved_for_product`：视觉与权限审核完成后才允许同步产品。

权限状态与采集状态分离。登记表中的 `approved_for_product` 与 `permission_status` 是可选的内部治理字段，不参与“映射和 Logo 文件是否齐全”的技术闭环判断。团队可根据实际展示方式和自身审核结论更新这些字段；任何下载成功都不应自动改写审批结论。

## 7. 失败、重试与例外

- HTTP 超时、TLS、403、限流属于网络状态，重试时保留原失败记录，不改变品牌身份。
- 官网不暴露 Logo 时，依次转查官方媒体包、新闻稿、父公司品牌页、精确官方资产覆盖和官网页面渲染，不立即采用低清 favicon。
- 只有在不存在可靠官网资产路径，或无法从官网取得精确子品牌标志时，才使用广告品牌帧，并记录源视频、时间码、裁切框和人工审核状态。
- 低分辨率官方文件只能作为已披露兜底，必须保留原始尺寸、来源和状态，不得把放大后的 224×224 输出描述为高分辨率母版。
- 不能确认主体或末帧无清晰标志时，状态保持未完成；不得用文字截图、AI 图或第三方近似图冒充。

## 8. 增量维护

审核台新增或修改视频后执行：

1. 重建 `brand-normalization-input-v1.json`。
2. 重建映射并审核新增原始品牌值。
3. 对新增 `canonical_brand_id` 发现官网并采集 Logo。
4. 对已有品牌比较官网当前 Logo 与本地 SHA-256/视觉轮廓，识别品牌升级。
5. 重建 v3 目录与审核页，运行闭环校验。
6. 只有批准项才复制到产品仓库；采集库与产品发布目录分离。

## 9. 可重复执行命令

```bash
cd /path/to/AdGenie-Review-Library
npm --prefix collect install
node collect/discover-brand-official-sites-v3.mjs --limit 269 --delay-ms 0
node collect/collect-brand-official-logos-v3.mjs --limit 269 --delay-ms 0
node collect/collect-brand-rendered-page-logos-v3.mjs --status official_asset_collected_quality_upgrade_required --limit 269
node collect/collect-brand-campaign-frame-logos-v3.mjs --force --limit 10
node collect/finalize-brand-low-resolution-fallbacks-v3.mjs
node collect/build-brand-logo-catalog-v3.mjs
node collect/validate-brand-logo-closure-v3.mjs
```

日常增量维护运行动态完整性校验；它会按当前输入数量检查视频、品牌身份和资产集合是否严格对应：

```bash
node collect/validate-brand-logo-closure-v3.mjs
```

复核本次交付的固定快照时运行基线校验：

```bash
node collect/validate-brand-logo-closure-v3.mjs --baseline
```

动态校验只有在当前全部视频映射完整、全部标准品牌身份来源完整、每个品牌都有 224×224 本地标准化 Logo，且没有待采集、网络重试、低清升级或人工裁切状态时才通过。`--baseline` 额外断言本批次仍为 853 条视频、269 个品牌和 6 个广告证据身份例外。通过表示技术采集闭环完成，不代表替团队作出商标或发布审批判断。

## 10. 运行环境

- Node.js 20 或更高版本；运行 `npm --prefix collect install` 安装 `sharp` 与 `playwright-core`。
- 常规官网发现与下载需要 `curl`。默认从 `PATH` 查找，也可设置 `CURL_PATH`。
- 只有广告视频截帧需要 `ffmpeg`。默认从 `PATH` 查找，也可设置 `FFMPEG_PATH`。
- 只有 JavaScript 渲染官网兜底需要本地 Chrome / Chromium / Edge。默认自动查找，也可设置 `CHROME_PATH` 或传 `--executable-path`。
- 默认尊重系统代理；仅在明确需要绕过代理时设置 `ADGENIE_NO_PROXY=1`。
- CI 或已有共享 Node 依赖目录可用 `ADGENIE_NODE_MODULES` 指定；团队本地优先正常执行 `npm install`。
