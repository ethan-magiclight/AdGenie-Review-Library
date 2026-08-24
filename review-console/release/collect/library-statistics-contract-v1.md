# AdGenie 审核台供给统计合同 v1

## 目的

这份合同定义审核台行业、商品品类、时长三类供给统计的唯一口径。三类维度通过独立 Tab 查看和导出，不再混入同一张层级表。统计结果用于研发按行业配置模板 `type`，不等同于人工批准清单，也不改变 `creative-library-state.json` 中的审核状态。

## Scope

- `formal_three_sources`（默认）：`ads_of_the_world`、`best_ads`、`stash`。
- `youtube_legacy`：历史直接 YouTube 搜索结果，单独展示，不冒充三渠道正式采集。
- `all_library`：以上两类合并，用于审计全库。

每个 scope 同时输出记录数和 `canonical_master_id` 去重后的母片数。默认排除 `blacklisted` 记录，并在统计元数据保留排除数量；不把 `approved` 或 `core_template_eligible` 当作全部供给。

## 维度与分类

三个 Tab 的行合同互斥：

1. `industry_overview`（默认）：一行一个 canonical 行业，另保留一行待确认行业；不显示品类子行或时长列。稳定键为 `industry_id`。
2. `product_categories`：一行一个 `industry_id::product_category_id` 路径，父行业只作路径标识，不插入行业小计或时长列；同名品类的多个合法父行业不得错误合并。
3. `duration_distribution`：固定输出四个互斥时长区间，包括零值行；行业只作为顶部过滤上下文，不变成表内维度。稳定键为 `duration_band_id`。

行业与品类只使用正式字段；`industry_candidate`、`product_category_candidate` 和 `classification_candidate` 只用于 `candidate` 诊断，不会伪装成已确认分类。

- 正式字段完整且没有待人工确认标记：`confirmed`。
- 正式字段缺失但有候选证据，或规范化/冲突合同明确要求人工确认：`candidate`。
- 没有正式字段、没有可用候选且没有可解释的人工确认标记：`unclassified`。
- 空行业、`Other`、跨行业和 `Unclassified` 保留在待确认行，不进入正常行业下拉。
- 行业选项按确认记录数划分：`<10` 为 `long_tail`，不删除、不隐藏；零记录 registry 项仅进入审计诊断。
- 研发使用的稳定维度键是 `industry_id + "::" + product_category_id`；多父品类保留冲突标记，不强行合并。

## 时长

按 `duration_seconds` 原始数值精确判断，四个区间互斥：

1. `duration_le_30s`：`<= 30` 秒。
2. `duration_30_to_60s`：`> 30 && <= 60` 秒。
3. `duration_gt_60s`：`> 60` 秒。
4. `duration_missing`：空值、非数字或非正数。

展示四舍五入不改变分段；例如 `30.03` 属于第二段。`duration_rows` 是全 scope 聚合，`duration_rows_by_industry` 使用同一遍 canonical taxonomy、黑名单、母片和可交付规则生成；浏览器不得从全量视频重新猜测这些指标。AOTW 的 `>40s` 历史 hold 不在本统计合同中静默排除，如需质量门应作为独立字段呈现。

## 质量与去重

每个维度行至少保留：`record_count`、`unique_master_count`、`unique_deliverable_master_count`、`pending_review_count`、`approved_count`（工作流状态标签）、`core_template_eligible_count`、`classification_*_count`、`dimension_conflict_count`、`canonical_mapping_*` 和 `source_breakdown`。行业行、品类行和时长行分别只暴露本维度需要的键；不通过跨维度列制造第二套隐式分类。导出保留原始值及映射规则，便于研发追溯“原始值 → canonical 值”，而不把规范化结果写回审核状态。

可交付母片必须同时具备已验证媒体资产和真实 Contact Sheet/10 帧证据。跨来源相同母片共享 `canonical_master_id`，统计不删除来源记录或来源证据。

## 导出与追溯

CSV/TSV 只导出当前 Tab，并带：`view_id`、`scope_id`、当前 `filter_industry_id`、`include_blacklisted=false`、`generated_at`、statistics schema version、statistics contract path、状态文件 SHA-256、taxonomy version、taxonomy policy SHA-256、methodology version。行业导出不含品类或时长字段，品类导出不含行业小计或时长字段，时长导出不夹入行业/品类数据行。正式状态文件仍是唯一事实源；统计字段是只读派生结果。实现位于 `web/lib/library-statistics.mjs`，行业选项合同位于 `web/lib/library-taxonomy.mjs`。
