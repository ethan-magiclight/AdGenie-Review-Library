# STASH 2025–2026 阻塞

## PROCESS_RULE_VIOLATION（2026-08-20）

- 一次只读敏感信息扫描命令末尾误用了任务书明确禁止的 `|| true`。扫描本身没有命中、没有修改文件，也没有用于跳过构建或测试失败；但按“违反即失败”规则必须如实记录，不能把本次交付声明为完整成功。

## GITHUB_DELIVERY_BLOCKED（2026-08-20，连续 3 次后停止）

1. `git push -u origin codex/stash-source-ingestion`：`LibreSSL SSL_connect: SSL_ERROR_SYSCALL`。
2. `gh auth status -h github.com`：`ethan-magiclight` 与 `Ahakunamatata` 的 keyring token 均为 invalid；未执行交互式 refresh。
3. 再次直接 `git push`：同一 `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`。

结果：本地实现提交为 `f9086be`，远端分支、PR、GitHub verify-package 与两套 Vercel 检查均未创建/触发；不合并 main。

## DISCOVERY_TOTAL_MISMATCH（2026-08-20）

- Advertising: All 页面原文报告 `686 videos`。
- 同一登录态页面实际 DOM 只有 664 个 `.collection-playlist`，稳定位置为 `pi=0…663`；每行有图/标题双链接，共 1328 个链接。
- 滚动 HTML 根节点到真实底部后仍为 664 条；无 Load more/下一页控件，官方 `stash_ajax.js` 也未提供全量 playlist 分页端点。
- 因此当前可断点发现 664 个真实候选，`reported_total_gap=22`、`discovery.complete=false`；不得声称已全量发现 686。

## DISCOVERY_COLLECTOR_ATTEMPTS_EXHAUSTED（连续 3 次，停止重试）

1. 严格要求唯一稳定 key 数等于 686，30 秒轮询与 2 次内部重试后超时；错误预览证明 total=686 且候选解析正常。
2. 改用末尾 `pi=total-1` 验证完整序列，错误证据为 `raw_links=1328`、`max_pi=663`，从而确认页面只交付 664 行。
3. 改为保存真实 664 条并显式记录 gap=22，但运行前 CDP Proxy 变为 `ECONNREFUSED :3456`；按三次失败规则不再发起第四次。

结果：生成了 `candidates=0`、`records=0` 的原子 checkpoint/records，并补录三条失败 run；依赖成功 discovery 的 10 条详情采集批次跳过。collector 代码保留正确的 partial-discovery 状态合同，待外部条件改变后从该 checkpoint 续跑。

## MEDIA_DELIVERY_BLOCKED（2026-08-20，停止入库与扩量）

- 无 Cookie 请求 STASH 详情 URL 返回 HTTP 200，但响应处于登出态，且不包含已登录播放器中的 Vimeo ID 或 `progressive_redirect/playback` locator。
- 已登录播放器的 MP4 查询参数包含 `loc`、`log_user`、`signature`；按任务边界不得持久化或把该短效 URL 当作稳定交付链接。
- 对当前短效 MP4 和仅含数值 ID 的 `https://player.vimeo.com/video/:id` 做无 Cookie HEAD 验证，均在 8 秒硬超时内未响应；尚无可证明的稳定 resolver。
- 下载区仍明确显示 `Download - Subscription required`，不得绕过。由于 10/10 稳定媒体门无法证明，禁止正式入库或扩到 100。

## 详情摸查连续失败 3 次（已转做不受影响项）

1. 第一次：内存探针在导航前因正则转义 SyntaxError 退出。
2. 第二次：无超时的媒体 HEAD 阻塞超过 20 秒，人工中断。
3. 第三次：加超时后发现 playlist 详情异步更新；请求 `178.03` 时读到 `178.13`，发生 refnum/clipnum 与 DOM 错配，结果全部作废并停止该验收项。

## 原始权限证据（2026-08-20）

- 登录态页面显示 `SIGN OUT`，Advertising: All 显示 `686 videos`。
- STASH 178.03 的下载区原文为 `Download - Subscription required`；本任务不会操作或绕过该入口。
- 同一条播放器返回 Vimeo progressive MP4；URL 含临时查询参数，观察到的数值 locator 为 `1207188087`，但未证明可稳定刷新，不计入成功媒体门。
