# Web CI 日志下载

在 GitHub → Actions → 本次运行 → Artifacts 下载
`web-diagnostics-<套件/分片>-<run ID>-<run attempt>`，也可使用本任务 Summary 的下载链接。
E2E、线上功能、交互/Freshchat、静态视觉、动画统一保存 14 天；成功、测试失败和超时都执行上传。
取消时尽可能上传已经落盘的部分；runner 被强制结束、失联、上传服务不可用时无法保证附件完整。

先阅读包内 `README.md`：它给出原始用例结果、失败步骤、关键错误和文件目录。
`manifest.json` 是完整文件清单，`identity.json` 关联 run ID、attempt、测试提交、应用提交、Release 和分片。
每次 Playwright 命令创建独立会话；每个用例、项目/视口、worker、重复及重试都有独立目录。
后续成功重试、候选基准比较、图集时钟对照及后续测试命令不会覆盖初次失败。

| 文件 | 来源及含义 |
| --- | --- |
| `browser.jsonl` | 导航前安装的公共上下文监听：所有级别 console 文本、pageerror、崩溃、请求/响应状态、失败和已有应用选线事件；覆盖手动上下文、新页面及 popup |
| `steps.jsonl` | 实际测试步骤和定位器、开始/结束、耗时、原始失败及测试执行输出；不保存输入值 |
| `timeline.jsonl` | 按宿主真实采集时间合并同例记录，不受动画虚拟时钟影响 |
| `proxy-*/proxy.jsonl` | 代理进程启动后到退出的现有 stdout/stderr；静默不表示没有错误 |
| `release-*/release-server-events.jsonl` | 既有 Release 服务采集器的持久化副本，覆盖启动、请求和退出清理 |
| `attachment-*` | 在下一条命令清理报告前复制的现有失败截图、录像及 connection-diagnostics 附件，与用例同目录 |
| `auth-*` | 视觉测试正式用例之前的登录态采集及验证上下文输出 |
| `*-manifest.json` | 各来源容量、保留时间范围、丢弃和截断统计 |

原有 Playwright HTML、截图差异和动画报告继续由现有 Artifact 保存。
未启用录像的测试不会新增录像；不会开启网络 trace 或原始流量录制。

`test.step-start` 表示驱动发出操作，`driver-completed` 表示驱动完成，不能据此认定应用已经处理。
应结合后续断言、页面输出或已有应用事件判断。未收到 HTTP 响应时记录
`status=unavailable response=not-received`；仅在实际收到响应时保存真实状态，不把断连推断成 HTTP 500。
错误保留可观察到的类型、网络代码、阶段与状态；不会推测内部切线原因。

日志只修改副本，复用已有连接资料脱敏规则；不读取 console 参数对象，不收集认证缓存、请求/响应正文或头部。
自由文本隐藏凭据字段、环境中的 Secret 值、认证串、地址和结构化对象/数组。
stdout/stderr 按完整行脱敏，跨数据块的凭据不会拆开保存；未换行尾部只在正常收尾时输出。
超长行超过 65536 字符时整行丢弃，并记录丢弃字符数。

浏览器、步骤、测试输出和代理输出每来源最多 8 MiB，保留最早事件，超过容量后丢弃后续事件；
每文本字段最多保留脱敏后前 2000 字符。来源清单记录准确丢弃条数、字节、截断字符数和时间范围。
Release 服务保留最早 10000 事件并记录丢弃量；既有连接及代理诊断历史仍保留最近 5000 事件和 dropped 计数。
持久化目录位于 `.ci-diagnostics/`，独立于会被 Playwright 清理的 `test-results/`。

应用未输出、构建时删除、系统已覆盖的日志，以及未接入的后端内部日志均不可恢复。
缺少日志不能证明没有发生错误；采集不可用、未开始测试或收尾未完成都应结合 Actions 原步骤判断。
应用代码、视觉阈值、重试次数、账号隔离和合并门禁保持原有规则。

本机仅验证本次日志链路，无需真实账号或业务服务：

```sh
node --import tsx --test e2e/helpers/diagnostic-log.test.ts e2e/helpers/diagnostic-recorder.test.ts e2e/helpers/diagnostic-persistence.test.ts e2e/helpers/ci-diagnostics.browser.ts scripts/release-diagnostics.test.mjs
```

浏览器自测使用已安装的 Chromium 和 Python 标准库测试源，覆盖成功、受控失败、超时、重试成功、
早期 console、新页面、真实 503、无响应断连、截图关联及公开哨兵脱敏，并确认失败退出码未被覆盖。
