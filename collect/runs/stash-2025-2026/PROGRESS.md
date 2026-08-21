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
19. Chrome CDP 已解除（2026-08-20）：用户截图确认远程调试已勾选、服务运行于 `127.0.0.1:9222`；持续前台 Proxy 实测 `/health` 为 `connected=true`，`/targets` 正常返回。未操作或关闭任何用户标签，也未创建新标签。GitHub `push=false` 与稳定媒体 resolver 缺失仍阻止远端交付和媒体门。
20. GitHub 身份已修正（2026-08-21）：本机 GitHub CLI 已切换到仓库所有者 `ethan-magiclight`，API 实测目标仓库 `admin=true`、`push=true`；远端同名分支与 PR 均不存在。推送前 22 个变更文件仍全部命中任务白名单，计划以 `codex/review-console-standalone`（`ff1989b`）为 PR base，不合并 main。
21. GitHub 交付已完成（2026-08-21）：分支首次推送到 `ethan-magiclight/AdGenie-Review-Library`，远端 SHA 与本地 `cee6dc2` 一致；以 `codex/review-console-standalone`（`ff1989b`）为 base 创建唯一 Draft PR #2。该 HEAD 的 `verify-package`、两套 Vercel deployment 与 Vercel Preview Comments 全部通过；PR 明确保持 draft、STASH=0、不得合并，等待发现完整性与稳定媒体交付门解除后再完成 10 帧预审和恰好 100 条入库。
22. 审核台零记录状态已显式化（2026-08-21）：用户现场指出“平台筛选”无法证明实际收录；实时页面核验确认 STASH 选项存在但结果为 0。现已把选项改为 `STASH（0 · 媒体门阻塞）`，并在空表格说明停止入库原因与方法论入口；新增 UI 合同测试先红后绿，完整 build、独立包生成/校验与包内 21 项测试全绿，仍保持 843 videos、118 review_events、STASH=0、local_video_files=0。
23. 媒体 resolver 路径已实现（2026-08-21）：稳定 Vimeo ID → 无 Cookie 获取 player HTML → 提取短效 `/config/request` → 无 Cookie 获取 Vimeo CDN HLS；短效 config/HLS 仅在内存，ID、host、TTL 和 CDN 均严格校验。
24. resolver 红→绿：缺导出 0/1 → 10/10 媒体测试通过；真实 `VID178:3 / 1207188087` 返回 HTTPS HLS，剩余约 3598 秒。本机 Node 直连 Vimeo 为 `UND_ERR_CONNECT_TIMEOUT`，resolver library 提供 CDP fallback，浏览器内两个 fetch 均为 `credentials:omit` 且标签自动关闭。
25. 10 条试采媒体门未通过：固定尝试 10 条且不补第 11 条，结果 1/10；`VID178:3` locator/resolver 通过，另 9 条后台直达详情没有生成 locator。正常页面点击单条验证 `VID178:4 → 1207188095` 成立，但随后 STASH 新 playlist 请求重定向 `/login/`，停止浏览器操作与扩量。
26. 当时真实交付状态仍为 STASH=0：collector 保持 `pending_video`/`MEDIA_DELIVERY_BLOCKED:ten_item_resolver_gate_incomplete`，不因单条 resolver 成功越过 10/10、10 帧、去重与恰好 100 条门禁；843 videos、118 review_events 尚未修改。该媒体原因已由第 29 条的 10/10 实测取代。
27. 文件边界复核：完整 `/api/videos/:id/media` 接线需要修改 `web/server.mjs`，但任务白名单未包含该文件；越界草稿已撤回，生成包已重新同步。当前只交付允许范围内的 resolver library、测试和阻塞证据，不声称审核台 API 已接通。
28. GitHub 交付更新（2026-08-21）：白名单 8 文件提交 `c6848eb` 已推送到正确仓库 `ethan-magiclight/AdGenie-Review-Library` 的 `codex/stash-source-ingestion`；Draft PR #2仍以 `codex/review-console-standalone` 为 base。该实现 HEAD 的 `verify-package`、Vercel Preview Comments 与两套 Vercel deployment 全部成功，未合并 main。
29. STASH 登录态恢复后媒体门完成（2026-08-21）：固定 10 条不补样本，`VID178:3/4/6/13/19/24` 与 `VID177:1/4/6/7` 全部从已初始化 playlist 的正常点击取得稳定 Vimeo ID，并由无凭证 resolver 解析为可信 Vimeo CDN HLS；`attempted=10 / passed=10 / failed=0`，主标签恢复到 `STASH 178.03`。
30. 播放器判定修正：部分详情会同时装载主广告与 `#btsplayer` 幕后花絮播放器；媒体门只认非 BTS 主播放器，`VID178:6` 的主广告 ID=`1207188123`，不把花絮 ID=`1207418728` 错当母片。短效 config/HLS 始终仅在内存，证据文件只保存稳定 ID、CDN host、HLS 布尔值和 TTL 下界。
31. 当前状态：媒体解析门已解除，但完整 10 条试采仍未完成；详情采集 3 批上限已耗尽，且审核台 API 接线所需 `web/server.mjs` 不在白名单。STASH 继续保持 0 条、843 videos、118 review_events、local_video_files=0，不扩量、不重做已通过的媒体门。
