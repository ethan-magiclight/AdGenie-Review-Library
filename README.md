# AdGenie

AdGenie 是一个处于早期阶段的 AI 品牌广告生成产品工作区。目标是让电商品牌和商家从商品素材出发，通过可复用的优质广告模板完成广告策划、生成和结果管理，而不是从空白 Prompt 开始制作。

当前仓库同时承载产品规划、静态 Demo、品牌广告样片采集与审核台、生成工作流实验和本地产物。它们是同一产品探索过程中的不同工作面，不代表完整生产产品已经集成完成。

## `AdGenie-logo` 分支交付

这个分支是供产品、数据和研发团队共同维护的**品牌归一映射与 Logo 资产库**，不包含首页、审核台或视频采集产品功能改造。它交付：

1. 审核台 853 条模板视频的原始品牌字段到 269 个标准品牌的可追溯映射；
2. 269 个标准品牌对应的身份来源、原始 Logo 证据和 224×224 透明 PNG 标准资产；
3. 审核台出现新品牌后，继续执行品牌归一、官网发现、Logo 采集、格式标准化、人工复核和完整性校验的方法与脚本。

团队接手请先阅读 [`collect/BRAND_LOGO_LIBRARY.md`](collect/BRAND_LOGO_LIBRARY.md)。它说明了权威文件、目录结构、正确品牌判定、Logo 来源优先级、新增品牌流程、运行环境和提交检查清单。完整采集规则见 [`collect/brand-logo-methodology-v3.md`](collect/brand-logo-methodology-v3.md)。

克隆并切换到本分支后，可执行以下命令验证当前 853 条视频、269 个品牌和 269 份 Logo 资产是否闭环：

```bash
npm --prefix collect install
npm --prefix collect run verify
```

本分支的当前资产版本是 v3。历史 v1/v2 Logo 文件不是新增开发入口；产品消费建议读取 `collect/brand-logo-catalog-v3.json`，人工巡检打开 `collect/brand-logo-review-v3.html`。

## 项目地图

| 路径 | 当前角色 | 权威边界 |
|---|---|---|
| `docs/` | 产品规划、需求工作簿和设计方案 | 文档头部状态为准；`待评审` 内容不是已实现事实 |
| `demo/` | 本地静态产品 Demo 和设计参考 | 目录被 Git 忽略，只用于本机原型验证，不作为协作事实源 |
| `web/` | 可本地启动的品牌广告样片审核台 | 运行命令与数据行为以 `web/package.json`、代码和 `web/README.md` 为准 |
| `collect/` | 采集方法论、题材与品类定义、Best Ads / AOTW Campaign 视频源、样片数据和历史快照 | 当前事实源与退役入口以 `collect/README.md` 为准 |
| `workflows/` | 耳机广告生成工作流实验 | 每个目录的 contract、`workflow-status.json` 和 QA 记录只证明该次实验状态 |
| `runs/` | 充电宝等生成运行记录 | 属于本地实验现场，不等于产品能力或线上状态 |
| `outputs/` | 工作簿预览和历史渲染输出 | 可再生成的本地产物，已被 Git 忽略 |
| `tools/` | 旧 Demo 素材工具 | 已被 Git 忽略，不是当前产品入口 |
| `PROJECT_HEALTH.md` | 当前状态、风险和待决事项 | 只记录现役结论，不承担历史变更日志 |

## 当前可运行系统

目前仓库中可独立运行的是 `web/` 品牌广告样片审核台：

```bash
cd web
npm run import
npm run dev
```

默认访问：

```text
http://127.0.0.1:4173
```

部署或交付前运行最快相关门禁：

```bash
cd web
npm run build
```

这里没有前端打包产物；`npm run build` 会执行语法检查、采集配置校验和审核台状态数据校验。

## 现役事实源

- AdGenie 工作区范围与目录关系：本文件。
- 审核台怎么启动和维护：`web/README.md`、`web/package.json`。
- 审核台当前导入数据版本：`web/scripts/import-seed.mjs`。
- 采集方法论、题材、品类、Best Ads / AOTW 来源合同和活动采集入口：`collect/README.md` 及其中列出的 JSON 事实源。
- 产品规划：`docs/` 中标明状态和日期的文档；尚未拍板的多个方案保持 `pending`，不能写成已实现能力。
- 单次生成实验：对应 `workflow-status.json`、`run-report.json`、contract 和 QA 记录。

## 数据与操作安全

- 人工审核运行状态保存在 `web/data/creative-library-state.json`，不要把它当作可随意重建的纯 seed 数据。
- `npm run reset:data` 会覆盖人工状态；只有任务明确要求时才执行，并且必须先运行 `npm run backup:data`。
- `backfill:metadata`、采集器、视频下载和外部 provider 调用可能访问网络或产生费用，不应作为普通本地检查运行。
- `demo/`、`workflows/`、`runs/` 和生成媒体中可能同时存在唯一输入、验收证据和可再生成缓存；未完成逐项分类前不要整目录删除。
- 密钥、Token、Cookie 和 `.env` 内容只能通过环境变量或受控本机凭证提供，不进入仓库、日志或文档。

## 当前成熟度

- 完整 AdGenie 产品：处于规划和静态 Demo 阶段，生成能力尚未集成为生产系统。
- 样片审核台：适合单人本地使用；低并发内网可试用。
- 多人公网使用：仍需要数据库、鉴权、并发写入保护、备份恢复和真实部署验证。
- 最新风险、未验证状态和需要拍板的事项见 `PROJECT_HEALTH.md`。
