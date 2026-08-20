# AdGenie Review Console

独立部署的广告视频审核台。该目录由上游 AdGenie 工作区自动生成，不要直接编辑生成文件。

## 数据范围

- 完整审核状态：`web/data/creative-library-state.json`
- 视频资源：仅远程链接，不包含 MP4/MOV/WebM 文件
- 预览资源：仅包含表数据实际引用的联系表图片
- 来源证据：包含状态文件 `source_files` 声明的 JSON

## 本地验证

```bash
+npm run build
+npm start
+```

默认地址：`http://127.0.0.1:4173`。

## 研发接入

- `GET /api/bootstrap`：获取完整审核台表数据。
- `GET /api/videos/:id/media`：获取当前可播放/下载的视频链接。
- `POST /api/videos/:id/media`：强制刷新临时媒体链接。
- `GET /api/videos/:id/media/download`：跳转到当前有效的视频下载地址。

当前 JSON 写入适合本地单人审核。Serverless 部署用于数据与播放链路验证；多人持久审核需要接入数据库或对象存储。
