# AdGenie 品牌映射与 Logo 资产库

这个目录交付三项可复用能力：

1. 审核台全部模板视频的原始品牌字段到标准品牌的映射；
2. 每个标准品牌对应的来源证据、原始 Logo 与统一规格 PNG；
3. 审核台新增品牌后，可重复执行的发现、采集、标准化、复核和校验流程。

当前 v3 基线覆盖 853 条审核台视频、329 个原始品牌值、269 个标准品牌、269 份身份来源记录和 269 份本地标准化 Logo。4 条没有品牌主体的视频保留明确的非品牌结果，不伪造映射。

## 权威文件

| 层级 | 权威文件 | 用途 |
|---|---|---|
| 原始输入 | `brand-normalization-input-v1.json` | 从审核台抽取的视频与原始品牌证据 |
| 归一规则 | `brand-normalization-rules-v1.json` | 别名、地区账号、联名和人工覆盖规则 |
| 映射结果 | `brand-normalization-map-v1.json` | 视频级映射与 269 个标准品牌汇总 |
| 品牌身份 | `brand-official-site-registry-v3.json` | 官网或已复核广告证据 |
| Logo 登记 | `brand-assets-v3/registry.json` | 来源、文件、哈希、尺寸、状态和审批元数据 |
| 原始/输出资产 | `brand-assets-v3/<brand-id>/` | `source/` 保留来源，`output/` 存标准 PNG |
| 联合目录 | `brand-logo-catalog-v3.json` | 映射、身份和资产的统一消费接口 |
| 人工审核页 | `brand-logo-review-v3.html` | 全品牌视觉巡检 |
| 机器校验结果 | `brand-logo-closure-validation-v3.json` | 最近一次完整性校验结果 |

`brand-assets-v3`、`brand-logo-catalog-v3.json` 与 `brand-logo-review-v3.html` 是当前资产版本。历史 v1/v2 文件不应作为新增开发的输入。

## 快速验证

```bash
git clone <repository-url>
cd AdGenie-Review-Library
npm --prefix collect install
npm --prefix collect run verify
```

`verify` 会检查所有脚本语法、重建联合目录，并执行本次 853 / 269 快照的严格基线校验。新增审核台数据后，请运行不锁定数量的动态校验：

```bash
npm --prefix collect run catalog
npm --prefix collect run validate
```

## 新增或更新品牌的标准流程

1. 从审核台状态文件重建输入：

   ```bash
   node collect/build-brand-normalization-input.mjs /path/to/review-console/state.json
   ```

2. 重建映射，检查报告里的新增原始值、冲突和未解析项：

   ```bash
   node collect/build-brand-normalization.mjs
   ```

3. 如有别名、地区账号、联名或同名品牌歧义，修改 `brand-normalization-rules-v1.json`，再重建映射。不要直接篡改生成的映射来掩盖规则缺失。
4. 为新增标准品牌发现官网；同名或低置信候选写入 `brand-official-site-overrides-v3.json`：

   ```bash
   node collect/discover-brand-official-sites-v3.mjs --retry --limit 50
   ```

5. 从已确认的官方页面采集 Logo：

   ```bash
   node collect/collect-brand-official-logos-v3.mjs --retry --limit 50
   ```

6. 只有官网依赖 JavaScript 渲染、无法直接取得资产时，使用页面元素兜底：

   ```bash
   node collect/collect-brand-rendered-page-logos-v3.mjs --limit 50
   ```

7. 只有没有可靠官网资产或必须取得精确子品牌标志时，使用已复核广告视频截帧；时间码和裁切框写入 `brand-campaign-frame-crops-v3.json`：

   ```bash
   node collect/collect-brand-campaign-frame-logos-v3.mjs --retry
   ```

8. 重建目录、打开审核页逐项确认，并运行动态完整性校验：

   ```bash
   npm --prefix collect run catalog
   open collect/brand-logo-review-v3.html   # macOS；其他系统直接用浏览器打开
   npm --prefix collect run validate
   ```

## 来源与正确性判定

来源优先级为：官方品牌规范/媒体包 → 品牌官网明确引用资产 → 母公司正式品牌页 → 已确认的官方账号头像 → 已复核品牌广告画面。第三方图库只用于发现或交叉核对，不能单独作为最终来源；不使用生成式 AI、手工描摹或字体重打制造品牌 Logo。

“正确品牌”不是靠图形相似度猜测，而是同时核对审核台标题和行业、官网域名和结构化身份、母子品牌关系、广告中的实际主体，并把来源 URL、候选证据、文件 SHA-256 和人工覆盖保留下来。完整判定规则见 `brand-logo-methodology-v3.md`。

## 输出标准

- 原始来源文件不改形状和比例，保留原始文件及 SHA-256。
- 标准输出为透明背景、sRGB、224×224 PNG。
- Logo 内容按比例缩放到最大 184×184，四周至少 20px 透明留白。
- 前端建议显示为 56×56 CSS px，使用 `object-fit: contain`。
- SVG 在写入前拒绝脚本、事件处理器、`foreignObject` 和对象嵌入。
- 统一的是承载画布，不拉伸、不重排、不自动反色品牌图形。

## 环境与可移植性

- 必需：Node.js 20+、`curl`、`npm --prefix collect install` 安装的 `sharp`。
- 页面渲染兜底：Chrome / Chromium / Edge，以及 `playwright-core`。
- 广告视频截帧兜底：`ffmpeg`。
- 可选环境变量：`CURL_PATH`、`FFMPEG_PATH`、`CHROME_PATH`、`ADGENIE_NO_PROXY=1`。
- 脚本不依赖某个成员的用户名、Codex 缓存目录或 macOS `sips`。

## 提交检查清单

- 原始审核台品牌值仍保留，规则变更可追溯。
- 视频 ID 集合与映射 ID 集合完全一致，没有重复或未解析记录。
- 标准品牌、身份来源、资产登记三者 ID 集合完全一致。
- 每个标准输出都位于 `brand-assets-v3` 内，是 224×224 PNG，且哈希匹配登记表。
- 新增人工覆盖写在 overrides / crops 等输入文件中，不只修改生成文件。
- `npm --prefix collect run validate` 通过；仅在复核当前固定快照时再运行 `validate:baseline`。
- `git diff --stat origin/main...HEAD` 不包含 Web、审核台业务代码或其他采集渠道的无关改动。
