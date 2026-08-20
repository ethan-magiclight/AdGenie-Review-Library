# AdGenie 项目健康状态

更新时间：2026-08-20

## 当前结论

AdGenie 当前是一个多工作面产品探索仓库，不是已经集成完成的生产产品：

- `docs/` 和本地 `demo/` 承载产品规划与交互原型；
- `web/` 是可独立运行的品牌广告样片审核台；
- `collect/` 是采集、分类、方法论和样片事实源；
- `workflows/` 与 `runs/` 是尚未纳入正式产品的广告生成实验现场。

当前可实际使用的系统是本地审核台。完整的“商品输入 → 模板推荐 → 视频生成 → 结果管理”产品流程仍处于规划、Demo 和分散实验阶段。

## 已核对的本地事实

| 主题 | 当前事实 | 证据 |
|---|---|---|
| Git | 仓库已初始化，当前分支为 `main`，存在 `origin/main`，工作树包含未提交开发内容 | `git status --short --branch`、`git worktree list` |
| 审核台入口 | Node 静态前端 + JSON 写入 API，默认端口 `4173` | `web/package.json`、`web/server.mjs` |
| 审核台导入 | 当前 seed 导入读取 `library-v9`、`consumer-electronics-review-v5` 和 `stats-v9` | `web/scripts/import-seed.mjs` |
| 审核状态 | 人工状态写入 `web/data/creative-library-state.json` | `web/server.mjs`、`web/README.md` |
| 采集入口 | 新活动入口为 `collect/collect-latest.mjs`；历史 gap 脚本不再作为活动入口 | `collect/README.md` |
| Campaign 视频源 | Best Ads 已有 181 候选/92 records；AOTW Film 全量发现完成 29,702/495 页、29,680 唯一候选，详情累计 545 records/882 视频资产/560 terminal、剩余 29,120；双站联合样本为 30 Campaign/40 review items/2 providers/40 Contact Sheets | `collect/runs/aotw-film-2025-2026/batch-report.json`、`collect/runs/best-ads-aotw-sample-40/batch-report.json`、两站 checkpoint |
| 审核台媒体 | 支持 YouTube iframe、HTML5 MP4/HLS 与 Contact Sheet 回退；新来源真实写入前强制 fresh backup | `web/public/app.js`、`web/scripts/ingest-source-records.mjs` |
| Demo | 静态 HTML 产品 Demo，生成、进度和下载含模拟行为 | `demo/PRODUCT.md` |
| 部署 | 仓库存在 Vercel 配置，但本次未验证远端 deployment 或真实用户 URL | `vercel.json` |

## 当前关键风险

### 1. 产品权威定义尚未拍板

`docs/产品架构与能力规划-v1.md` 标记为“待评审”，本地 `demo/PRODUCT.md` 描述的用户范围和能力边界更广。两者都是重要输入，但当前没有证据支持把其中任一份直接宣布为最终产品合同。

需要明确一份正式产品定义后，再把另一份压缩为设计参考或历史方案。

### 2. 审核台 seed 与 runtime 状态仍耦合

`web/data/creative-library-state.json` 同时承担导入结果和人工审核运行状态。当前工作树中该文件存在大幅修改，说明它包含不可随意丢弃的在研或人工数据。

在拆分 seed 与 runtime 之前：

- 不自动运行 `npm run reset:data`；
- 任何批量修复前先运行 `npm run backup:data`；
- 不把该文件的 dirty 状态当作普通生成残留清除。

### 3. 本地实验资产缺少保留策略

`workflows/` 和 `runs/` 同时包含输入、合同、提示词、QA、最终输出、依赖和缓存，且目前没有 tracked 文件。部分实验仍标记为 `in_progress`、`video_generation`、`requires_human_listening` 或存在 blocker，因此不能按目录整体归档或删除。

需要先为每次实验拆分：

- 必须保留的输入与授权信息；
- 可复现定义、contract、manifest 和状态记录；
- QA 与最终交付物；
- 可再生成的依赖、下载和渲染缓存。

### 4. Demo 知识位于 Git 忽略目录

整个 `demo/` 当前被 `.gitignore` 忽略，但其中的 `PRODUCT.md` 和 `DESIGN.md` 含有重要产品原则。根 README 已提取稳定的工作区定位；剩余产品细节仍需在产品定义拍板后迁入 tracked 文档，不能直接把 `demo/` 当作无价值旧原型清理。

### 5. 多人公网能力尚不成立

审核台仍使用本地 JSON 文件写入，没有登录鉴权、操作人身份、并发写入保护或自动恢复机制。Vercel 配置文件的存在不能证明已经部署，更不能证明多人写入安全。

## 当前待决事项

1. 确定正式产品定义：以哪份文档为主，目标用户和首发边界是什么。
2. 确定 `demo/` 的去向：保留本地、提取后归档，还是转为 tracked 原型。
3. 确定 `workflows/` 与 `runs/` 的长期存储：Git、Git LFS、对象存储或本地归档。
4. 为需求工作簿 `v1` 至 `v11` 指定当前版本和历史保留规则。
5. 把审核台 seed 数据与人工 runtime 状态拆开。
6. 若要团队长期使用，迁移 SQLite / Postgres，并增加鉴权、并发保护和备份恢复。

## 验证状态

- 代码：`verified-current`；2026-08-20 `cd web && npm run build` 通过 syntax、批次报告器、既有 collection policy、新来源合同/taxonomy/mapping 与 635 条状态数据校验。
- 双站样本：`imported-local`；40/40 真实 Contact Sheet 与视觉预审、30 Campaign 来源合同、2 provider、10 个视觉行业候选全绿；经 fresh backup 后正式导入 40 items（Best Ads 20+AOTW 20），全部 `pending_review`，formal genres/approved/core eligibility 为 0；幂等复跑 0 added/40 skipped，当前状态 635 videos。
- 运行态：`pending`；本次未启动本地服务，也未验证远端部署。
- 文档：`changed-and-verified`；根入口和当前状态已按本地代码与配置重写，`git diff --check` 通过。
- 规则：`changed-and-verified`；项目根新增最小 `AGENTS.md`，控制在 60 行以内。
- 记忆：`out-of-scope`；未读取或修改 Agent 自动记忆。
- 工作区：`pending`；实验资产和清理候选仍保留，等待分类与用户确认。

未消除的门禁 warning：

- 采集校验中有部分 source brand 未进入当前 Top brand registry；
- 状态数据中仍有 `Apparel & Footwear::Unclassified` 未注册分类引用；
- 历史数据中仍有 20 个 duplicate canonical masters；
- 635 条视频中有 378 条缺 metadata，但缺失状态标记当前一致，没有形成校验错误。
