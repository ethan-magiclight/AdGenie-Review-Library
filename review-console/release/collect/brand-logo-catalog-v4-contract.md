# AdGenie Brand Logo Catalog v4 Overlay Contract

更新日期：2026-08-23

## 目的

`brand-logo-catalog-v4.json` 是三渠道品牌候选与多资产根 Logo 的只读集成目录。它把三渠道 `brand-normalization-map-v2.json`、旧 v3 Logo 候选、当前官网证据、staging Logo registry 和独立视觉门禁合并为一个可审计 sidecar，不修改审核台正式状态，不产生人工确认或产品批准。

## 输入优先级

1. 品牌集合、显示名、别名、视频数和身份确认状态只取 v2 mapping。
2. 官网证据优先取三渠道 staging identity registry，旧 v3 catalog 仅作缺失回退。
3. Logo 默认使用旧 v3 base 资产。
4. staging overlay 只有同时满足以下条件时才能覆盖 base：
   - registry 声明的文件存在且位于声明的资产根内；
   - SHA-256、字节数和 PNG 尺寸与文件一致；
   - 标准化文件是真实 224×224 PNG；
   - `visual-review-gate.json` 与当前 asset registry SHA 一致；
   - 该品牌视觉复核记录为 `overlay_eligible=true`，且复核路径和 SHA 与 registry 一致。
5. 缺失视觉门禁、未复核或视觉拒绝的 overlay 只保留 `overlay_review` 审计信息，绝不生成 overlay `asset_ref`。

## 路径合同

顶层 `asset_roots` 是运行时唯一可接受的资产根白名单。每个 root 包含：

- `root_id`
- `source_role`：`base` 或 `overlay`
- `repo_relative_root`
- registry 的仓库相对路径和 SHA-256

每个可用 Logo 的 `asset_ref` 包含：

- `asset_root_id`：必须命中顶层 `asset_roots`
- `asset_scope`：只允许 `internal_preview`、`product_release`、`permission_blocked`
- `repo_relative_source_path`
- `repo_relative_normalized_path`

所有路径都以仓库根目录为基准。构建器拒绝绝对路径、反斜杠、空路径段、`.`、`..`、跨品牌目录、symlink 越界和资产根越界。

## 身份与权限门禁

- `identity_confirmed` 只继承 v2 mapping，官网或 Logo 自动发现不能提升它。
- `identity_confirmed=false` 时，任何来源的 `approved_for_product=true` 都会被压制，并记录 `source_approval_suppressed=true`。
- base 或 overlay 任一记录出现 `express_permission_required`，有效 scope 始终为 `permission_blocked`。
- `internal_preview` 只用于内部研发联调和人工复核，不代表产品授权。
- `product_release` 只有身份已确认、资产源已明确批准且无权限阻断时才可能出现。
- URL 只保留稳定 HTTP(S) 证据；含凭证、Token、签名、鉴权、过期参数或嵌入账号密码的 URL 会使构建失败。

## 构建

```bash
cd __ADGENIE_WORKSPACE__
node collect/build-brand-logo-catalog-v4.mjs
node --test collect/build-brand-logo-catalog-v4.test.mjs
```

构建器支持 `--mapping`、`--base-catalog`、`--identity-registry`、`--base-asset-root`、`--overlay-asset-registry`、`--overlay-visual-review`、`--overlay-asset-root`、`--output`、`--repo-root` 和自定义 root ID。overlay registry 或视觉门禁尚未生成时可以安全构建空 overlay；`--require-overlay-registry` 可将 registry 变为强制输入。

输出使用同目录临时文件、`fsync` 和原子 rename。写入前会再次检查全部输入是否出现、消失或变更，避免把并发中的半成品发布为目录。

## 当前快照边界

- 三渠道视频映射：2,673
- 品牌候选：1,337
- identity confirmed：0
- identity review required：1,337
- 旧 v3 base 选中资产：175
- 内部预览资产：170
- 权限阻断资产：5
- 产品发布资产：0
- staging 发现资产：5
- staging 视觉通过：0
- staging 视觉拒绝：5

这 5 个被拒绝的 staging 文件分别涉及 favicon、活动物料、含义不清的 touch icon、页面插图和品牌身份误配；它们留作审计证据，但不会进入研发可预览 Logo 路径。
