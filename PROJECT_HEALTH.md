# AdGenie Creative Library 项目健康状态

更新时间：2026-08-02

## 当前结论

项目已经可以作为本地品牌广告样片审核工具使用，但还不是完整的多人协作生产系统。

当前推荐定位：

- 单人本地审核：可用。
- 小团队内网共享查看：可试用，但需要固定一台主机并做好备份。
- 多人同时审核 / 公网部署：需要数据库、鉴权和并发写入保护后再推进。

## P0 已修复项

- 修复拉黑 / 取消拉黑审核事件的 before / after 快照污染风险。
- 增加 `待补元数据` 系统状态。
- 对缺少发布时间或时长的视频显示“元数据缺失”。
- 在重归类 / 纠错区域给出 `METADATA_MISSING` 和 `VISUAL_OUTDATED_SUSPECTED` 原因码提示。
- 增加数据备份脚本：`npm run backup:data`。
- 增加数据校验脚本：`npm run validate:data`。
- 增加 P0 数据修复脚本：`npm run repair:data`。
- 增加语法检查命令：`npm run check`。
- 增加部署前健康门禁：`npm run build`，当前执行 `check + validate:data`。
- 增加 `.gitignore`，避免提交本地备份、临时文件和密钥文件。

## 当前关键风险

### 1. 元数据缺失

历史库 `library-v9` 中有较多视频缺少 YouTube metadata，尤其是：

- `publish_date`
- `duration_seconds`

缺少这些字段时，不能稳定执行以下审核门：

- 年代 / 产品代际判断。
- 时长范围判断。
- “过旧”排除规则。

当前临时规则：

- 缺发布时间或时长时，标记 `METADATA_MISSING`。
- 只凭视觉疑似过旧时，可写 `VISUAL_OUTDATED_SUSPECTED`。
- 补到明确 metadata 后，再写 `OUTDATED_PRODUCT_OR_VISUALS` 或 `DURATION_OUT_OF_RANGE`。

### 2. JSON 文件写入不适合多人并发

当前平台把运行状态写入：

```text
web/data/creative-library-state.json
```

单人本地使用问题不大，但多人同时写入存在覆盖风险。正式团队部署建议迁移到：

- SQLite，本地 / 内网轻量部署；
- Postgres / Supabase，团队长期协作；
- 或 append-only `review_events` 事件日志 + 状态重建。

### 3. reset 会覆盖人工状态

`npm run reset:data` 会从 `collect` 重新生成平台状态文件，可能覆盖人工标记。

执行前必须先运行：

```bash
npm run backup:data
```

### 4. 尚未配置鉴权

当前本地服务没有登录、权限或团队成员身份。公网部署前必须增加：

- 登录鉴权；
- 操作人记录；
- 审核事件不可随意篡改；
- 备份与恢复机制。

## GitHub 发布建议

可以把项目整理成 GitHub 仓库，但建议分层提交：

- 提交：`web/`、`collect` 的核心 JSON/Markdown、`docs` 中必要工作簿、项目文档。
- 谨慎提交：大量历史 `outputs/`、contact sheet 图片。
- 不提交：`web/data/backups/`、`.env*`、本地临时文件、inspect 输出。

当前 `.gitignore` 已经覆盖常见本地文件和运行备份。

当前目录尚未初始化为 Git 仓库。准备发布时建议先在本地初始化并做第一版提交，再添加远程仓库。

## 部署建议

### 低成本内网版

- Node server。
- 本地 JSON 或 SQLite。
- 固定一台主机。
- 每日自动备份。
- 只允许内网访问。
- 部署命令：`npm run build` 后 `npm run start`。

### 团队长期版

- API 服务。
- Postgres / Supabase。
- 登录鉴权。
- 审核事件表。
- 视频样片表。
- 状态表。
- 方法论版本表。
- 采集 run 表。
- 定时 metadata backfill。

## 推荐下一步

1. 批量补齐缺失 YouTube metadata。
2. 把 `creative-library-state.json` 拆成 seed 数据和 runtime 数据。
3. 引入 SQLite 或 Postgres。
4. 增加用户身份和操作人。
5. 增加采集结果 ingest 命令。
6. 增加自动备份和导出。
