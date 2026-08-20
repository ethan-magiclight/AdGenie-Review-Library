# 审核台独立部署包

`review-console/release/` 是可独立运行和部署的审核台项目，由当前工作区事实源自动生成。

## 维护原则

- `web/data/creative-library-state.json` 始终整体进入发布包，不截取单个渠道或批次。
- 视频只保存远程页面、播放或下载链接，不复制 MP4/MOV/WebM 文件。
- 联系表图片按状态数据中的 `contact_sheet` 引用精确收集。
- `source_files` 声明的来源 JSON 同步进入发布包，保留数据审计链路。
- `review-console/release/` 是生成结果，不直接手工修改；修改上游 `web/`、`collect/` 或打包脚本后重新生成。

## 生成与校验

```bash
cd web
npm run package:standalone
npm run validate:standalone

cd ../review-console/release
npm run build
```

打包器会拒绝以下情况：

- 任一视频缺少远程视频引用；
- 任一状态数据来源文件不存在；
- 任一被引用联系表图片不存在；
- 发布包包含本地视频文件；
- 发布包状态文件与 manifest 哈希不一致。

## 部署

仓库根 `vercel.json` 指向 `review-console/release/web/server.mjs`。也可以把 `review-console/release/` 单独作为仓库根目录部署，其内部包含独立的 `package.json` 和 `vercel.json`。
