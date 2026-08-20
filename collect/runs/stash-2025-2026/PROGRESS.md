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
10. 已停止：空 checkpoint 记录 3 个 discover 失败 run；本地 build/独立包全绿并提交实现 `f9086be` 与阻塞记录 `81ab9c1`，push/PR 因 GitHub TLS 与失效 keyring token 连续 3 次失败而停止。
11. 续跑审计 #2（2026-08-20）：分支仍以 `ff1989b` 为祖先，HEAD=`81ab9c1`；CDP 依赖检查停在 Chrome 远程调试授权等待，未创建标签、未重试采集/媒体探测/push。媒体门与外部交付阻塞未改变。
12. 续跑审计 #3（2026-08-20）：审计前 HEAD=`46600ee`、tracked worktree 干净；CDP 再次持续等待 Chrome 授权后被有界终止，未创建标签或发起任何第 4 次请求。同一外部条件已连续 3 个 goal turn 未改变，且合法稳定媒体 resolver 仍缺失，达到正式 blocked 阈值。
13. 恢复审计 #1（2026-08-20）：goal 被恢复为 active；CDP 检查在终止等待时短暂输出 `proxy: ready`，但紧接着本地 `/targets` 立即 `ECONNREFUSED :3456`；补充的无中断检查连续等待 60 秒仍停在 Chrome 授权提示。未列出/创建标签或访问 GitHub，恢复后的阻塞计数从 1 开始，媒体门仍失败。
14. 恢复审计 #2（2026-08-20）：审计前 HEAD=`600bbf8`、tracked worktree 干净；CDP 连续等待 30 秒仍停在授权提示，终止时才输出 ready，随后 `/targets` 再次立即 `ECONNREFUSED :3456`。未创建标签或发起外部请求，同一阻塞已连续 2 个恢复 turn。
15. 恢复审计 #3（2026-08-20）：审计前 HEAD=`44bbd9c`、tracked worktree 干净；CDP 连续等待 30 秒无 ready 后有界终止，`/targets` 再次立即 `ECONNREFUSED :3456`。同一阻塞已连续 3 个恢复 turn，媒体门与远端交付仍无解除证据，达到再次正式 blocked 阈值。
16. 再次恢复审计 #1（2026-08-20）：goal 再次恢复为 active；Chrome 控制扩展连接成功，但自动访问 `chrome://inspect/#remote-debugging` 被浏览器安全策略明确禁止，且不得用底层命令或其他界面绕过。临时标签已关闭；需用户手动允许远程调试后才能继续验证 Proxy，媒体门仍失败。
17. 再次恢复审计 #2（2026-08-20）：专用 GitHub 连接确认身份为 `Ahakunamatata`；上游仓库仅 `pull=true`、`push=false`，同名分支与 PR 均不存在，账户下也没有同名 fork，连接不提供创建 fork 能力。未发起必然失败的远端写入，需上游写权限或用户提供 fork；媒体门仍失败。
18. 再次恢复审计 #3（2026-08-20）：审计前 HEAD=`fc3dd71`、tracked worktree 干净；GitHub 权限仍为 `push=false`，分支/PR/fork 仍不存在；CDP 等待 20 秒仍需用户授权，随后 `/targets` 立即 `ECONNREFUSED :3456`。稳定媒体 resolver 仍缺失，连续 3 个恢复 turn 无解除证据，再次达到 blocked 阈值。
