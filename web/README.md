# AdGenie Creative Library

内部品牌广告样片采集 / 分类 / 审核 / 状态标记平台。

第一版目标是把现有 `collect` 目录里的 v11 数据变成可本地启动、可团队共享查看的工作台：

- 按商品品类 × 广告题材查看样片覆盖矩阵；
- 在平台内直接预览 YouTube 视频和 10 点 contact sheet；
- 视频列表字段可显示 / 隐藏；
- 可筛选商品品类、题材、状态；
- 状态筛选支持多选、包含已选、排除已选、全选、反选和清空；
- 可给视频标记状态；
- 可新增 / 删除自定义状态；
- 可拉黑错误视频；
- 可重归类商品品类和题材；
- 可写审核原因；
- 可把某条人工原因标记为“方法论候选线索”；
- 对缺少发布时间 / 时长的历史样片显示“元数据缺失”，避免把“看起来很老”写成不可审计规则；
- 方法论沉淀第一版只记录，不自动改规则。

## 启动

```bash
cd /Users/hakunamatata/Desktop/AdGenie/web
npm run import
npm run dev
```

默认访问：

```text
http://127.0.0.1:4173
```

如果要让同一局域网团队成员访问，可以指定 Host：

```bash
HOST=0.0.0.0 PORT=4173 npm run dev
```

然后让团队成员访问本机局域网 IP 的 `4173` 端口。

## 数据来源

`npm run import` 会读取：

- `collect/library-v9.json`
- `collect/consumer-electronics-review-v5.json`
- `collect/ad-video-genres-v1.json`
- `collect/consumer-electronics-taxonomy-v1.json`
- `collect/stats-v9.json`
- `collect/采集方案与优质判定标准.md`
- `collect/采集方案与优质判定标准-v2.md`
- `collect/*contact-sheets*/manifest.json`

导入结果写入：

```text
web/data/creative-library-state.json
```

平台中的状态、重归类、拉黑、审核原因也会写回这个 JSON。

GitHub 首版默认不提交本地下载的视频、抽帧图片和历史输出目录。线上部署时视频预览仍通过 YouTube iframe 打开；列表缩略图会在本地 contact sheet 不存在时自动回退到 YouTube 缩略图。

## 重置数据

如果要从 `collect` 重新生成平台数据：

```bash
npm run reset:data
```

注意：这会用当前 `collect` 数据重新生成 `web/data/creative-library-state.json`，会覆盖平台里已有的人工标记。正式使用后应先备份该文件。

建议重置或批量修复前先运行：

```bash
npm run backup:data
```

## 维护命令

```bash
npm run build
npm run check
npm run validate:data
npm run backup:data
npm run repair:data
npm run backfill:metadata
```

- `npm run build`：部署前健康门禁；当前项目没有前端打包产物，会执行 `check + validate:data`。
- `npm run check`：检查前端、服务端和脚本语法。
- `npm run validate:data`：检查平台状态文件的结构、视频 ID、状态引用、审核事件和元数据缺口。
- `npm run backup:data`：把当前 `web/data/creative-library-state.json` 复制到 `web/data/backups/`。
- `npm run repair:data`：执行 P0 级状态修复，包括添加 `待补元数据` 系统状态、给缺 metadata 的视频打标、修复历史拉黑事件的 before 快照。
- `npm run backfill:metadata`：通过本机 `yt-dlp` 批量补齐 YouTube 发布时间和时长；会先自动备份当前状态文件，成功补齐后移除 `待补元数据`。

## 当前预置状态

系统预置状态：

- 待审核
- 需复刻
- 已复刻
- 暂搁置
- 待补元数据
- 已入库
- 已排除
- 已拉黑

其中系统状态不可删除；你可以在“状态管理”页新增 / 删除自定义状态。

## 字段显示控制

在“视频审核”页点击右上角“字段显示”，可以控制列表字段显示 / 隐藏。  
当前第一版字段偏好保存在浏览器 `localStorage`，不会影响其他团队成员。

## 元数据缺失处理

历史库 `library-v9` 中有一批视频缺少 YouTube metadata，平台会显示为“元数据缺失”。  
遇到这类视频时，不建议直接写“看起来很老”。推荐先记录：

- `METADATA_MISSING`：缺少发布时间或时长，无法执行年代 / 时长审核门。
- `VISUAL_OUTDATED_SUSPECTED`：视觉语言疑似过旧，但需要补元数据后确认。

补到明确发布时间或时长后，再使用更确定的规则：

- `OUTDATED_PRODUCT_OR_VISUALS`
- `DURATION_OUT_OF_RANGE`

人工集中审核前建议先执行：

```bash
npm run backfill:metadata
npm run validate:data
```

如果只想小批量验证：

```bash
npm run backfill:metadata -- --limit 10
```

如果 YouTube 返回 bot 校验，可以显式使用本机 Chrome 登录态：

```bash
npm run backfill:metadata -- --cookies-from-browser chrome
```

这会读取本机 Chrome Cookie 供 `yt-dlp` 请求 YouTube 使用；Cookie 不会写入项目文件或提交到 Git。

## 方法论沉淀策略

第一版不做自动化方法论更新。

人工审核时可以勾选“记录为方法论候选线索”。这些记录会出现在“方法论记录”页，后续可由 Codex 批量分析，再人工决定是否更新：

- `collect/采集方案与优质判定标准.md`
- `collect/采集方案与优质判定标准-v2.md`
- 采集 / 分类脚本规则

## 后续接采集脚本

下一步建议新增一个标准导入命令：

```bash
npm run ingest -- --file collect/new-run.json
```

目标是让每次本地采集脚本输出结构化 JSON 后，直接进入平台“待审核”队列，而不是继续手动合并 Excel。

当前第一版已经把数据落点和 API 形态准备好，后续只需要补 `collection_runs` 和 ingest 脚本。

## 部署注意

当前服务使用本地 JSON 文件作为运行状态存储，适合单人或低并发内网使用。  
如果要多人长期共享审核，建议升级到 SQLite / Postgres，并增加登录鉴权、并发写入保护和自动备份。

当前形态不适合直接部署到 GitHub Pages，因为平台需要 API 写入状态。

如果部署平台需要命令配置：

```bash
Build Command: npm run build
Start Command: npm run start
```
