# STASH 2025–2026 进度
1. 目标：接入恰好 100 条可稳定播放/交付、完成 10 帧预审且跨源不重复的 STASH Advertising 广告。
2. 顺序：基线与网页取证 → 10 条试采 → 媒体/视觉/去重门 → 审核台与独立包 → 扩到 100 → 提交与线上验收。
3. 已完成：从 `ff1989b` 创建 `codex/stash-source-ingestion`；祖先检查与基线 build 通过。
4. 基线：843 videos、118 review_events、2 个方法论渠道；测试 fail/skipped/todo 均为 0。
5. 已验证：Advertising: All 报告 686，但当前 DOM 仅枚举 `pi=0…663` 共 664 条，缺 22 条且无分页入口；按不完整发现保存。
6. 日期证据：170–176 来自 All Issues；177=`MAY 15/26`、178=`JULY 15/26` 来自各自 Issue 页；通用 OG 2021 日期无效。
7. 结构证据：详情含 STASH 编号、类型、Client、Agency、Director、Production/Animation、描述和 Vimeo progressive 播放器。
8. 媒体门：已确认为 `MEDIA_DELIVERY_BLOCKED`；无 Cookie 页面不暴露 Vimeo locator，短效 MP4/稳定 player 检查超时，正式入库与扩量已停止。
9. 已完成：新增 STASH collector、contract、6 个范围映射与 validator；稳定 key、Issue 日期、spec、媒体门及三类坏 fixture 红→绿自测全绿。
10. 已停止：空 checkpoint 记录 3 个 discover 失败 run；本地 build/独立包全绿并提交 `f9086be`，push/PR 因 GitHub TLS 与失效 keyring token 连续 3 次失败而停止。
