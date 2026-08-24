# AdGenie 品牌身份与证据合同 v1

状态：候选合同，供三渠道品牌治理和后续新增采集使用。
适用来源：Ads of the World、Best Ads、STASH。
历史 YouTube 不属于本合同的正式三渠道审计范围。

## 1. 目标

当前 `brand`、`primary_brand` 和 `brands[]` 同时承载消费品牌、广告主、母公司、地区实体、产品线、合作品牌和代理商。合同将“来源原始声明”“品牌身份”“品牌角色”“人工审核”拆开，使审核台和研发模板库都能稳定使用品牌维度，同时不覆盖来源证据和人工结论。

本合同不授予自动批准权限。品牌候选、别名候选和关系候选必须保持待审核；不得改变 `review_status`、`approved`、`core_template_eligible` 或既有审核事件。

## 2. 品牌注册表

每个已解析品牌使用不可变注册表条目：

```json
{
  "brand_id": "brand_01...",
  "brand_display_name": "Coca-Cola",
  "brand_aliases": [
    {
      "value": "COCA COLA",
      "alias_type": "punctuation_variant",
      "locale": null,
      "status": "confirmed",
      "source_evidence_ids": ["brand_evidence_01..."]
    }
  ],
  "parent_brand_id": null,
  "legal_entity_id": null,
  "review_status": "confirmed",
  "reviewed_by": "local-user",
  "reviewed_at": "2026-08-23T00:00:00.000Z"
}
```

约束：

- `brand_id` 使用 UUID/ULID 等不可变 ID，不从可能变化的展示名生成。
- `brand_display_name` 代表面向用户的消费品牌名称；不得用组内最高频大小写自动决定。
- `brand_aliases[].alias_type` 允许：`case_variant`、`punctuation_variant`、`legal_entity`、`regional_entity`、`product_line`、`abbreviation`、`translation`、`historical_name`、`typo`。
- 去标点 identity key 只能产生候选关联；涉及母公司、地区实体、缩写、产品线或拼写修复时必须人工确认。
- 法律实体与消费品牌分别建模；不能仅通过删除 `Inc`、`Ltd`、`AG`、`Company` 等后缀自动合并。

## 3. 广告记录品牌字段

正式记录使用 ID 和角色，不把多品牌压成一个字符串：

```json
{
  "primary_brand_id": "brand_01...",
  "brand_ids": ["brand_01...", "brand_02..."],
  "brand_relations": [
    { "brand_id": "brand_01...", "role": "primary" },
    { "brand_id": "brand_02...", "role": "co_brand" }
  ],
  "advertiser_entity": {
    "raw_value": "Example Holdings AG",
    "brand_id": null
  },
  "agency_entities": [
    { "raw_value": "Example Agency", "entity_id": null }
  ],
  "brand_review": {
    "status": "pending",
    "manual_lock": false,
    "evidence_ids": ["brand_evidence_01..."]
  }
}
```

允许的 `brand_relations[].role`：

- `primary`：广告主要面向消费者传播的品牌。
- `co_brand`：联合露出的独立品牌。
- `product_line`：品牌下产品线或型号。
- `parent`：母品牌或集团。
- `advertiser`：来源页面的 Client/广告主实体。
- `regional_entity`：地区分支。
- `sponsor`：赞助关系。
- `unknown`：证据不足，必须保持待审核。

约束：

- `primary_brand_id` 必须存在于 `brand_ids[]`。
- 代理商和制作公司禁止进入 `brand_ids[]`；分别写入 `agency_entities[]` 和 production 字段。
- `brand`、`primary_brand` 可在迁移期作为派生展示兼容字段，但不得继续充当身份主键。
- 合作品牌不得写成 `Brand A / Brand B` 单一身份。

## 4. 来源声明与证据

每条来源声明单独保存，不能只保留归一后的字符串：

```json
{
  "brand_evidence_id": "brand_evidence_01...",
  "raw_value": "PEPSICO",
  "source_field": "stash_client",
  "claimed_role": "advertiser",
  "source_site": "stash",
  "source_record_id": "VID150:1",
  "source_detail_url": "https://www.stashmedia.tv/...",
  "evidence_text": "Client: PEPSICO",
  "snapshot_sha256": null,
  "collected_at": "2026-08-21T00:00:00.000Z",
  "confidence": "source_claim",
  "resolution_status": "pending"
}
```

`source_field` 至少区分：

- `aotw_published_sentence_brand`
- `aotw_published_sentence_agency`
- `best_ads_client`
- `best_ads_title_prefix`
- `stash_client`
- `stash_title_prefix`
- `visual_brand_close`
- `visual_ocr`

要求：

- 保留稳定详情页、来源记录键、采集时间和原始文本或快照 hash。
- 不保存 Cookie、Token、签名 URL 或短效媒体地址。
- Contact Sheet 和十帧视觉审核可支持人工确认，但不能替代来源声明。
- `raw_source.client`、`brand_source` 等采集证据必须进入正式 handoff，不能在导入审核台时丢失。

## 5. 来源解析规则

### Ads of the World

- 从 published sentence 分离 `brand` 与 `by ad agency/agencies`。
- 同时支持 `ad agency` 和 `ad agencies`；agency marker 及其后值禁止进入 `brands[]`。
- marker 前多个值保留为多个 brand claims，关系状态为 `pending`。

### Best Ads

- `Client` 是来源广告主声明，不自动等同于消费品牌。
- 标题冒号前内容作为独立 title-prefix claim。
- 如果 Client 看起来像人员/职位、与标题品牌冲突或仅是母公司，进入人工确认。

### STASH

- `Client` 和标题引号前内容必须同时保留。
- 不再使用 `client || titlePrefix` 静默覆盖；分别记录 claimed role。
- 地区实体、集团、代理商、产品品牌冲突进入人工确认。

## 6. 自动化边界

允许自动执行：

- 大小写、Unicode 引号、空白和明确标点差异映射到同一 identity candidate。
- 按明确 `by ad agencies:` marker 将代理商声明与品牌声明分栏。
- 计算风险、生成候选和审计报告。

禁止自动执行：

- 用最高频字符串决定 `brand_display_name`。
- 删除公司后缀后直接合并法律实体与消费品牌。
- 将标题品牌无条件覆盖 Client，或反向覆盖。
- 将联合品牌压成单一品牌身份。
- 自动设置 `approved=true`、移除 `pending_review` 或赋予核心模板资格。

## 7. 人工审核与事件

人工品牌变更写入统一事件：

```json
{
  "action": "brand_update",
  "video_id": "stash:VID150:1:643622901",
  "before": {
    "primary_brand_id": null,
    "brand_ids": [],
    "brand_review": { "status": "pending", "manual_lock": false }
  },
  "after": {
    "primary_brand_id": "brand_doritos",
    "brand_ids": ["brand_doritos", "brand_pepsico"],
    "brand_review": { "status": "confirmed", "manual_lock": true }
  },
  "reason_code": "SOURCE_AND_VISUAL_EVIDENCE_CONFIRMED",
  "evidence_ids": ["brand_evidence_01", "brand_evidence_02"],
  "created_by": "local-user",
  "created_at": "2026-08-23T00:00:00.000Z"
}
```

后续自动导入必须保护 `manual_lock=true` 的品牌字段和既有 `brand_update` 事件。

## 8. 校验门禁

导入和 handoff validator 至少检查：

- 品牌 ID 引用完整且 `primary_brand_id` 属于 `brand_ids[]`。
- 每个 resolved brand 至少有一个 `brand_evidence_id`。
- agency marker、已登记代理商和 production company 不得进入品牌 ID。
- 多品牌必须有逐项关系，不能只保留拼接字符串。
- 来源 raw claim 与 canonical identity 同时存在。
- 人工锁和 review events 前后数量、内容保持不变。
- 审计脚本明确排除历史 YouTube，并输出状态 SHA-256 和规则版本。

## 9. 审计实现

- 脚本：`web/scripts/audit-brand-governance.mjs`
- 规则版本：`brand-governance-audit-v1`
- 默认输出：`collect/runs/brand-governance-20260823/`
- 输出：`audit-report.json`、`record-risks.json`、`AUDIT.md`

审计只读正式状态文件，不写回数据，也不产生批准结果。

## 10. 审核台只读 Sidecar

审核台通过 `/api/bootstrap.brand_governance` 合成品牌治理 sidecar，不向视频对象或 `creative-library-state.json` 写回候选结果。

- 正式范围固定为 Ads of the World、Best Ads、STASH；历史 YouTube 不生成品牌治理候选。
- 每条正式记录都按 `video_id` 精确关联审计结果。`record-risks.json` 未列出的记录显式标记为 `no_flag`，含义仅是“当前规则未发现风险”，不等于人工确认。
- `safe_auto` 只允许稳定 identity candidate 关联或明确 agency marker 分栏；`manual_confirmation` 必须进入人工队列；`cannot_determine` 表示现有证据不足。
- Runtime 必须同时读取 `audit-report.json` 与 `record-risks.json`，并要求两者内部 `state_sha256` 相同且等于当前状态文件 SHA-256。缺失、产物互相冲突或状态过期时，统一降级为 `not_audited`，不得继续展示旧风险结论。
- Sidecar 保留 `resolution_lane`、`risk_codes`、`suggested_actions`、规则版本、产物 SHA-256 和 freshness 状态，供研发追溯。
- 品牌归一映射和 Logo 仍是候选层：只按精确 `video_id` 关联旧映射，不自动改展示名；`approved_for_product=false` 必须明确显示未批准。
- `express_permission_required` 的 Logo 不生成可访问 URL，`/brand-logos/:brand_id.png` 必须返回 404；Web 只开放标准化 PNG，不开放原始资产或证据目录。
