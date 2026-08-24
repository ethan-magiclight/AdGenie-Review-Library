# AdGenie 行业与商品品类合同 v3

## 1. 目的与适用范围

`adgenie-taxonomy-v3.json` 是 AdGenie 广告模板库的封闭两级分类合同。它回答两个问题：

1. 一级行业：广告主正在销售、提供或推动的核心对象属于哪个业务领域。
2. 二级商品品类：这条广告具体推广的商品、服务、体验、机构或社会行动是什么。

本合同服务于三类场景：采集任务生成分类候选、审核台人工确认、研发按行业 `type` 和商品品类配置模板。它不改变视频审核状态，不代表广告已获批准，也不授权自动覆盖 `creative-library-state.json`。

适用来源包括 Ads of the World、Best Ads、STASH，以及未来按同一合同接入的新来源。来源自身的 Industry、Category、playlist 或媒体标签只是证据，不是 AdGenie 正式分类。

## 2. 合同原则

### 2.1 封闭 registry

- v3 固定 20 个一级行业和 124 个二级商品品类。
- 正式字段只能引用 `adgenie-taxonomy-v3.json` 中存在的稳定 ID。
- 新来源、采集器、AI 模型、导入器和审核台运行时都不得自动新增 registry 项。
- 未匹配值保留原始证据并进入候选队列；不得自动把原始字符串补入正式 registry。
- 新增、合并、拆分或废弃分类必须通过 taxonomy 版本升级完成。

### 2.2 唯一父级

- 每个 `product_category_id` 只有一个 `parent_industry_id`。
- 正式记录必须满足 `product_category.parent_industry_id === industry_id`。
- 同一现实对象在不同营销语境下可能需要不同、名称明确的品类，例如：
  - 通勤自行车：`cat_auto_commuter_micromobility`。
  - 竞技自行车：`cat_sports_performance_cycling`。
  - 电动牙刷：`cat_beauty_hygiene_oral`。
  - 临床牙科设备：`cat_health_devices_diagnostics`。
- 不再用“一个品类挂多个父行业”的方式表达语境差异。

### 2.3 按广告对象归类

分类对象是当前 Campaign 正在推广的主要 offer（商品、服务、体验、机构或行动），不是：

- 画面发生的场景；
- 代言人的职业；
- 广告使用的媒介或制作风格；
- 商品出现的零售渠道；
- 品牌集团的全部业务；
- `Luxury`、`Premium`、`Digital`、`Sports` 等市场定位或传播形容词。

当 Campaign 同时推广多个 offer 时，只有存在明确主 offer 才能进入正式两级分类；否则保留多个候选并进入人工确认，不创建 `Cross-Category` 正式品类。

### 2.4 不设正式兜底类

以下值禁止成为正式一级行业或二级品类：

- `General`、`General <Industry>`；
- `Other`；
- `Unclassified`；
- `Unknown`；
- `Miscellaneous`；
- `Cross-Category`。

无法确定时，正式 `industry_id` 和 `product_category_id` 保持 `null`，候选状态写明缺失原因。空值是待处理事实，不用模糊兜底标签掩盖。

## 3. JSON 数据结构

### 3.1 兼容索引

为兼容现有审核台和统计模块，JSON 顶层保留两个扁平索引：

- `industries[]`：至少包含 `id`、`industry`、`zh`。
- `categories[]`：至少包含 `id`、`industry_id`、`industry`、`category`、`zh`。

扁平索引是运行时查询入口，不是另一套 taxonomy。详细定义以 `industry_definitions[]` 中相同 ID 的条目为准。

### 3.2 详细定义

`industry_definitions[]` 的每个一级行业包含：

- `id`：不可随展示文案变化的稳定 ID；
- `name_en`、`name_zh`：中英文展示名；
- `definition`：行业判定定义；
- `includes`：典型纳入范围；
- `excludes`：必须排除或转入其他行业的边界；
- `product_categories[]`：唯一归属本行业的二级品类。

每个二级品类包含：

- `id`；
- `parent_industry_id`；
- `name_en`、`name_zh`；
- `definition`；
- `includes`；
- `excludes`。

以下一致性必须由 validator 强制检查：

1. 一级行业 ID 唯一。
2. 二级品类 ID 唯一。
3. 每个二级品类的父级 ID 存在且唯一。
4. 扁平索引与详细定义的 ID、英文名、中文名和父级完全一致。
5. 正式禁用标签不出现在 registry。
6. 所有条目都有非空定义、`includes` 和 `excludes`。

### 3.3 Legacy 迁移索引

`legacy_industry_aliases` 和 `legacy_category_mappings.safe_aliases` 只收录语义明确的一对一映射；其目标是稳定 ID，而不是展示字符串。`legacy_industry_manual_review` 和 `legacy_category_mappings.manual_review` 保存一对多候选、原因和人工分发边界。

- `Retail Services`、`Professional Services`、`Sports & Outdoor` 等历史宽泛行业不得安全直映。
- `General*`、`Food Products`、`Travel & Tourism`、`Delivery Services`、`Sports & Recreation` 等宽泛品类不得自动晋级。
- 空品类执行 `missing_value_policy`，保持 `evidence_insufficient` 和正式品类空值。
- legacy mapping 只用于生成迁移候选；即便属于 `safe_aliases`，也必须遵守版本迁移审批和字段锁规则，不能由普通采集或导入任务直接改正式状态。

## 4. 一级行业边界

| 一级行业 | 核心判定 | 典型排除 |
| --- | --- | --- |
| Apparel, Footwear & Accessories | 广告对象是服装、鞋履、箱包、珠宝、腕表或可穿戴时尚配饰 | 美妆、智能穿戴、体育硬件、零售商店本身 |
| Beauty & Personal Care | 广告对象是美妆、个人卫生、日常口腔护理或理容工具 | 处方治疗、临床器械、宠物洗护 |
| Food & Beverage | 广告对象是人类食品、饮料、食材或餐饮服务 | 宠物食品、食品零售商店、医疗营养、厨电 |
| Home & Living | 广告对象用于住宅的布置、维护、改善或家庭服务 | 个人计算设备、工业设备、酒店住宿 |
| Consumer Electronics | 广告对象是消费级计算、音频、影像、智能穿戴或连接硬件 | 软件订阅、电信套餐、家务型电器、医疗器械 |
| Retail & Commerce | 广告对象是商店、购物目的地、商品集合、交易市场或多商户配送平台 | 制造商品牌单品、餐厅自身食品、B2B 货运 |
| Automotive & Mobility | 广告对象是道路车辆、个人交通工具或本地出行服务 | 旅客长途旅行、B2B 货运、竞技自行车、能源供应 |
| Financial Services | 广告对象是资金、支付、信贷、风险、投资或机构金融服务 | 购物会员、通用 SaaS、博彩游戏 |
| Healthcare & Pharmaceuticals | 广告对象是人类医疗服务、药品、临床器械、诊断或健康产品 | 日常美妆卫生、宠物医疗、非医疗运动恢复、公益倡导 |
| Sports, Fitness & Outdoor | 广告对象是体育硬件、健身设备、户外装备、训练服务或非临床恢复 | 运动服鞋、体育转播、医疗康复、通勤车辆 |
| Media, Arts & Entertainment | 广告对象是内容、订阅、文化机构、现场娱乐或观赛体验 | 电子游戏、软件工具、媒体硬件、旅游目的地 |
| Gaming & Toys | 广告对象是互动游戏、玩具、桌游、收藏品或博彩娱乐 | 游戏主机、体育转播、投资产品 |
| Education & Learning | 广告对象的主要结果是学习、技能、教学或资质 | 通用软件、普通出版内容、公益宣传 |
| Software & Digital Services | 广告对象是可复用的软件、云、AI、安全或数字平台 | 金融服务、教育优先产品、电信连接、纯人工咨询 |
| Telecommunications | 广告对象是移动、固定、卫星或企业网络连接 | 手机硬件、通信软件、云服务、广播内容 |
| Travel & Hospitality | 广告对象是旅程、住宿、目的地或旅行预订 | 本地网约车、货运、旅行保险、单一娱乐场所 |
| Business & Industrial Services | 广告对象是专业服务、企业运营、工业设备、制造投入、B2B 物流或工程 | 软件产品、金融产品、消费者家政、消费者配送平台 |
| Public Sector & Social Impact | 广告对象是公共服务、慈善、公益倡导或公民行动 | 商业医疗、商业教育、能源供应商、仍以商品为中心的品牌价值广告 |
| Pet Care & Supplies | 广告对象专用于伴侣动物及照护者 | 人类食品、动物保护倡议、畜牧工业投入、普通家居品 |
| Energy & Utilities | 广告对象是能源、水务、废弃物、燃料、充电或公用基础服务 | 电子设备充电器、环境倡导、汽车产品、家电 |

## 5. 重点交叉边界

### 5.1 Retail & Commerce

只有当 Campaign 的主 offer 是“来这里购物、浏览集合、完成交易、使用购物会员或多商户配送”时，才进入 Retail & Commerce。

- Nike 推广一双鞋：Apparel, Footwear & Accessories。
- 百货公司推广周年促销和全店商品：Retail & Commerce。
- 超市推广门店价格和商品集合：Retail & Commerce。
- 饮料品牌在超市渠道投放新品广告：Food & Beverage。
- 单一餐厅推广套餐：Food & Beverage。
- 多餐厅外卖平台推广选择和配送：Retail & Commerce。
- B2B 货运和供应链：Business & Industrial Services。

零售渠道、购买按钮或 DTC 模式本身不能把制造商品牌晋级为 Retail & Commerce。

### 5.2 Business & Industrial Services

本行业只接收主要面向组织购买的人工服务、工业硬件、工业材料、货运、工程和商业物业服务。

- 核心产品是 SaaS、云或 AI 平台：Software & Digital Services。
- 核心产品是咨询、代理、法律、审计或外包服务：Business & Industrial Services。
- 核心产品是商用贷款、支付或保险：Financial Services。
- 核心产品是工业机械或制造材料：Business & Industrial Services。
- 核心产品是商用车辆：Automotive & Mobility。
- 核心产品是工业能源供应：Energy & Utilities。

`Professional Services` 不能作为泛兜底；必须确认到具体二级服务或保留候选。

### 5.3 Sports, Fitness & Outdoor

体育场景不等于体育行业。按广告对象区分：

- 跑鞋、运动服、球衣：Apparel, Footwear & Accessories。
- 球拍、球类、健身器械、露营硬件：Sports, Fitness & Outdoor。
- 健身房、训练会员：Sports, Fitness & Outdoor。
- 体育赛事转播和观赛票务：Media, Arts & Entertainment。
- 临床康复设备：Healthcare & Pharmaceuticals。
- 日常运动恢复用筋膜枪：Sports, Fitness & Outdoor。
- 通勤自行车：Automotive & Mobility。
- 竞技、公路或山地自行车：Sports, Fitness & Outdoor。

### 5.4 Healthcare & Pharmaceuticals

本行业要求广告对象具有医疗、药理、诊断、临床护理或明确健康管理用途。

- 电动牙刷、牙膏、漱口水：Beauty & Personal Care。
- 牙科诊所、正畸、临床牙科设备：Healthcare & Pharmaceuticals。
- 普通护肤：Beauty & Personal Care。
- 处方皮肤治疗：Healthcare & Pharmaceuticals。
- 智能手表的一般运动和通知功能：Consumer Electronics。
- 医疗监测器、助听器、诊断设备：Healthcare & Pharmaceuticals。
- 疾病公益认知但不销售医疗 offer：Public Sector & Social Impact。
- 宠物药品和兽医服务：Pet Care & Supplies。

`Healthcare & Pharmaceuticals` 不是“与健康有关”的泛行业；仅有健康场景或健康措辞不足以晋级。

## 6. 原始证据、候选与正式字段

### 6.1 原始证据层

采集器必须原样保留：

- 来源详情页；
- 来源 Industry、Category、playlist 或标签；
- Campaign 标题、描述和 CTA；
- 品牌及具体业务线；
- 真实视频与 Contact Sheet/10 帧视觉证据；
- 证据采集时间与来源。

原始字段不可因 taxonomy 升级而覆盖。规范化映射必须保留 `raw → candidate → confirmed` 的完整链路。

### 6.2 候选层

AI、规则或来源映射只能写入 `classification_candidate`。候选至少包含：

```json
{
  "taxonomy_version": "3.0.0",
  "industry_id": "ind_beauty_personal_care",
  "product_category_id": "cat_beauty_hygiene_oral",
  "confidence": 0.91,
  "status": "manual_confirmation_required",
  "evidence": [],
  "alternatives": []
}
```

候选 ID 必须来自 v3 registry；无法映射的来源原值使用 `registry_unresolved`，而不是把字符串追加进 registry。

允许的候选状态：

- `candidate`：存在可解释候选，尚未确认；
- `registry_unresolved`：证据指向的概念不在当前 registry 或无法稳定映射；
- `evidence_insufficient`：证据不足以选择唯一行业与品类；
- `manual_confirmation_required`：存在冲突、跨边界或多候选；
- `migration_review_required`：版本升级后原正式值需要重新确认。

`mapped_candidate`、`safe_auto` 或高置信度可以作为内部 reason，但不能等同 `confirmed`。

### 6.3 正式层

正式分类必须同时具备：

- 有效 `industry_id`；
- 有效 `product_category_id`；
- 唯一且一致的父子关系；
- `classification_status = "confirmed"`；
- `classification_confirmed_by`；
- `classification_confirmed_at`；
- `classification_lock`；
- 对应人工审核事件或已批准的版本迁移事件。

仅有非空 `industry`、`product_category` 展示文本不能证明分类已确认。统计和行业下拉必须以正式 ID 与 `classification_status` 为准，不能以字符串非空作为 confirmed 代理。

## 7. 候选晋级正式的证据门

候选晋级前至少需要两个相互独立的证据类别，并且二者指向同一父子路径：

1. 来源详情证据：来源明确描述商品、服务或 Campaign 对象。
2. 品牌业务证据：品牌官方业务、产品页或可审计品牌线信息。
3. 视觉证据：真实视频/Contact Sheet 中的产品、包装、界面、门店、服务行为或明确文字。
4. Campaign 语义证据：标题、描述、对白、字幕或 CTA 明确指向 offer。

以下单项不足以晋级：

- 来源站点单一 Category；
- 品牌名称；
- 画面场景；
- 体育明星、豪华风格、公益口号等视觉语气；
- AI 高置信度；
- 同一模型生成的两段同源解释。

自动规则只能生成候选。正式写入需要人工确认，或经过以下门禁的版本迁移：

- migration manifest 明确记录旧 ID、新 ID、规则和证据；
- dry-run 输出无未知 ID、无多父、无锁冲突；
- 人工批准迁移批次；
- 应用前备份正式状态；
- 应用后逐条保留迁移事件和原值。

## 8. 人工确认与字段锁

### 8.1 确认行为

人工确认必须同时提交一级行业和二级品类，不允许只修改一个维度后留下不一致父子关系。审核事件至少记录：

- `video_id`；
- taxonomy 版本；
- before/after 的行业与品类 ID；
- reviewer；
- timestamp；
- reason code 与说明；
- 使用的证据引用。

确认分类不代表批准广告。`review_status`、`approved`、`core_template_eligible` 和分类确认相互独立。

### 8.2 锁规则

人工确认后锁定：

- `industry_id`；
- `product_category_id`；
- `classification_status`；
- `classification_confirmed_by`；
- `classification_confirmed_at`。

采集器、AI backfill、taxonomy normalization、新来源导入和统计任务都不得覆盖锁定字段。需要纠错时必须执行显式 reclassification：读取当前锁、创建新人工事件、同时更新父子 ID、重新加锁。不得通过清空 review events 或重建状态绕过锁。

## 9. 版本升级

### 9.1 版本语义

- Patch：定义、中文文案、includes/excludes 的非语义修正；稳定 ID 和父级不变。
- Minor：新增行业或品类，但不改变现有 ID 的含义和父级；仍需完整迁移评审。
- Major：合并、拆分、改变父级、改变分类语义或废弃稳定 ID。

展示名变化不应改变 ID。稳定 ID 一旦发布不得复用给不同含义。

### 9.2 升级产物

每次升级至少交付：

- 新 taxonomy 文件及 SHA-256；
- 旧 ID → 新 ID 的机器可读迁移表；
- `safe_one_to_one`、`manual_split`、`deprecated_no_replacement` 等迁移状态；
- 受影响记录数和人工锁冲突数；
- dry-run 预览；
- 迁移后的 validator 和幂等性结果；
- 正式状态应用前后 SHA-256。

一对多拆分不能自动选择。没有足够证据的记录转为 `migration_review_required`，保留旧正式值和版本证据，直到人工决定。

## 10. 新来源接入

新来源只能：

1. 保留来源原始分类。
2. 使用当前 v3 ID 生成候选。
3. 对未匹配概念写入 `registry_unresolved` 报告。
4. 提交 taxonomy gap proposal，说明定义、includes、excludes、与现有分类的区别、预计影响记录和唯一父级。

新来源不得：

- 把来源标签直接写入正式行业或品类；
- 因某来源出现新字符串而自动扩充 registry；
- 创建 `General`、`Other` 或 `Unclassified`；
- 绕过人工确认；
- 覆盖已锁定分类；
- 把 AI 候选冒充人工结果。

## 11. 统计与审核台消费规则

- 行业下拉只显示 v3 `industries[]` 中有正式确认记录的项目。
- 二级品类按 `parent_industry_id` 查询，不进行名称猜测或跨行业 fallback。
- 候选、未解析和迁移待确认记录进入独立诊断指标，不进入正式行业/品类供给数。
- 低频只是一项供给统计，不改变 taxonomy，也不能自动合并行业。
- 时长、媒体可交付、审核状态和 taxonomy 确认是独立维度。
- 导出必须包含 taxonomy version、taxonomy SHA、稳定 ID、展示名、确认状态、确认来源和原始证据引用。
- 正式统计不得把候选字段或非空展示字符串当作 confirmed。

## 12. 发布门禁

v3 从 candidate 进入 active 前必须通过：

1. JSON 可解析。
2. 行业数等于声明值。
3. 行业 ID、品类 ID 全局唯一。
4. 每个品类恰好一个有效父级。
5. 扁平索引与详细定义一致。
6. 每项都有中英文名、定义、includes、excludes。
7. 正式禁用标签不存在。
8. legacy alias 的目标行业 ID 都存在。
9. manual-review mapping 的候选行业 ID 都存在。
10. 新来源无法通过导入器扩充 registry。
11. 候选不会自动写入正式字段。
12. 人工锁在 normalization、merge 和 backfill 中保持不变。
13. 分类迁移不改变 `review_status`、`approved`、`core_template_eligible`、note 或 review events。
14. dry-run、备份、状态 SHA 和 validator 证据齐全。

在以上门禁完成前，v3 是封闭候选合同，不应直接覆盖现有 v2 状态或正式审核台数据。
