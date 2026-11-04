# 应用 #5159 修复前复现（CLRN #94）

关联：[复现任务 #94](https://github.com/kevinanew/clrn/issues/94)、[应用 #5159](https://github.com/kevinanew/laiwan_react_native/issues/5159)、[后续验收 #95](https://github.com/kevinanew/clrn/issues/95)。本目录是定向复现入口，文件使用 `.scenario.ts` 和独立配置，不加入默认 Playwright 套件。正确行为断言失败时命令返回非零；没有预期失败、跳过或自动重试。

## 合入门槛（尚未满足）

**PR #96 必须继续保持草稿，当前不能合入主干。** Issue #94 明确要求“不将未修复的失败用例直接并入主干”；独立配置、如实记录失败及复现工具自测通过均不能豁免该要求。现有客户端错误提示及后端吞错仍有正确行为断言失败，历史证据和这些断言完整保留。

解除阻断需先取得关联客户端、德州服务的修复版本及所需隔离环境，再固定完整提交、构建摘要和实际后端版本，重跑浏览器完整故障矩阵与后端 10 场景，补交全部正确行为断言通过的结果、消息出口、资金账本及恢复证据后，才能申请合入。不得以删除交付物、跳过、永久预期失败或放宽预期消除失败。本仓库的复现断言修复不改变外部产品行为，也不能代替上述通过证据；完整金币链路和 #94/#95 的其余验收项仍须分别完成。

## 已证实与尚未完成

- 真实 Release 页面初始化及登录成功；私人**记分牌**桌可真实创建、带入 100、入座。该对照不能代替金币桌正常补码。
- 准确房间的入座 WebSocket RPC 收到缺失错误字段的响应时，页面显示 `undefined-sit`。清除故障后点击真实重试入口，代理收到新命令及真实上游成功回复，正常带入后桌上筹码为 100。
- 未修改的德州源码、真实钱包 SDK、独立本机 HTTP 钱包和完整双方 all-in 流程，能够触发自动补码吞掉 `transaction_conflict` 的失败断言。钱包尚有 9845，失败没有扣款，实际引擎输出站起、带入提示及留座消息，但没有保留失败原因。解除业务故障后真实手动带入成功，钱包 9845 → 9690、桌上筹码 0 → 155，只有一笔新交易。
- 完整金币环境、服务版本及失败原因关联任务：[texas_holdem_flask #1648](https://github.com/kevinanew/texas_holdem_flask/issues/1648)。测试及证据保存在[草稿 PR #96](https://github.com/kevinanew/clrn/pull/96)，没有将任务标记为已完成。
- 共享 staging 的金币大厅启用 `check_ip_address=true`。本机两个独占账号同出口实测匹配 60 秒仍排队；配置是已观察事实，同 IP 是阻塞原因的推断，尚未取得实际匹配服务拒绝原因。
- **尚未复现原用户的完整金币桌事件**。隔离引擎不是已部署的完整德州服务；现有浏览器测试不是金币自动补码验收。实际 staging 德州、匹配和钱包部署版本尚未核实。

## 浏览器运行

从仓库根目录执行，Node、Playwright 和 Python 依赖沿用仓库锁文件及 `e2e/mitmproxy/requirements.txt`：

```sh
npm ci
npx playwright install chromium
uv venv --python 3.12 e2e/.venv
uv pip install --python e2e/.venv/bin/python -r e2e/mitmproxy/requirements.txt
node e2e/reproductions/issue-94/run.mjs
```

账号池使用 Git 共同元数据中的既有本机池；启动器取得原子锁、准备 10000 金币并回读，结束后释放。测试令牌使用 `TESTING_API_TOKEN`，也可用 `ISSUE94_TESTING_DEPLOYMENT_FILE` 指定已有 staging 部署文件的位置；不复制 Secret 到仓库。不得用 CI 专属账号替代本机池。

启动器从当前检出的 `deployments/staging.json` 下载固定 Release，校验实际字节摘要、构建信息及页面版本，启动独立本地静态服务器；失败不会回退线上。每轮输出在 `e2e/test-results/issue-94/<run-id>/`，默认使用唯一编号，也可指定 `ISSUE94_RUN_ID`。目录包括构建和测试指纹 `manifest.json`、机器可读 `results.json`、登录后录像、关键截图、脱敏连接及故障时间线。`MITMDUMP_PATH` 可指定已安装的 mitmdump。

定向选择案例：

```sh
node e2e/reproductions/issue-94/run.mjs --grep missing-fields
node e2e/reproductions/issue-94/run.mjs --grep http-503
node e2e/reproductions/issue-94/run.mjs --coin-baseline
```

最后一个命令额外取得第二账号锁，只检查金币匹配和入座前置条件。`ISSUE94_PEER_PROXY_URL` 可为第二个正常浏览器提供经批准的不同真实出口；不修改共享大厅的 IP 规则。未提供独立出口时应保留失败和排队现场，不能据此宣布金币对照成功。即使前置检查通过，也仍须执行并核对金币手动带入、自动补码及资金变化。

录像在真实登录完成后才开始：凭据只在未录像的上下文输入，同一会话及设备标识经内存交给新上下文，新页面照常初始化；不保存 storage state、不跳过初始化、不注入就绪标志。所有 trace 关闭。私人房间通过可见入口创建并关闭带入审核；清理只删除本次成功创建响应返回的确切 UUID，HTTP 或业务清理失败会使测试失败。

本目录截图统一通过 `screenshotAfterSettling`：恢复截图等待带入/错误弹窗节点实际移除；弹窗展开截图等待可见内容及其祖先的几何、缩放和透明度连续稳定 500 毫秒，并等待有限动画结束。持续循环的加载图标保持运行，不修改动画速度或隐藏弹窗。10 秒内不能稳定就使截图步骤失败，不退回即时截图。可独立运行真实浏览器验证：`node --import tsx --test e2e/reproductions/issue-94/screenshot.browser.ts`。

截图等待修正已在 CLRN `4810b8b4e4a91ec628bb8c59d02a9757e89e235b` 定向复测：正常带入、HTTP 缺失字段恢复、WebSocket 缺失字段恢复的截图步骤全部通过，原有两条业务缺陷断言仍失败。新截图见[弹窗完全展开](evidence/screenshot-settling/normal/02-buy-in.png)、[HTTP 恢复后弹窗完全关闭](evidence/screenshot-settling/http-missing-fields/02-http-recovered.png)、[完整错误弹窗](evidence/screenshot-settling/websocket-missing-fields/04-fault.png)。[新一轮版本和结果](evidence/screenshot-settling/results.json)与原先取证独立保存，旧截图保留历史，不冒充修正后的画面。

## 故障边界

| 边界 | 入口 | 故障 | 必须观察的结果 |
| --- | --- | --- | --- |
| 浏览器 → HTTP | `POST /v10/texas_holdem/room/<本轮房间>/buy_in/apply` | 503、504、真实延迟、断开、非 JSON、缺失字段、其他业务错误 | 真实 HTTP 状态、命中、可读提示、解除故障后的新请求及真实回复、筹码只有 100 |
| 浏览器 → WebSocket | Centrifuge `method=9`、`PUT /v10/texas_holdem/room/<本轮房间>/sit` | 丢回复造成真实客户端超时、连接断开、异常 JSON 帧、缺失字段、其他业务错误 | 原始命令编号、注入回复、故障期间再次重试仍命中、清除后新请求及真实上游回复 |
| 德州引擎 → 钱包 HTTP | 真实 `UserTransactionService.withdraw` | 交易冲突、真实不足、503、504、读取超时、断连、非 JSON、缺失字段、提交后丢回复 | SDK 实际解析及三次重试、真实引擎消息、钱包/桌上筹码及唯一交易变化 |

`texas_faults.py` 同时匹配确切节点、房间、方法及会话 token 的 SHA-256 指纹。控制接口只监听本机、校验随机 token，初始化、登录、健康检查和其他账号/房间透传。指纹只在控制进程内存使用，不写报告。HTTP 状态不会包装为 WebSocket 业务错误；没有 `player_not_enough_stack` 注入选项。代理沿用每例进程、独立证书目录和退出清理，不安装系统证书。

## 隔离后端运行

在仓库外准备源码，避免全仓检查扫描另一个项目。修复前固定版本为 `def3a1291c4ef0add64b46cc302d2ea730425675`：

```sh
git clone https://github.com/kevinanew/texas_holdem_flask /tmp/clrn-94-texas
git -C /tmp/clrn-94-texas checkout def3a1291c4ef0add64b46cc302d2ea730425675
uv sync --project /tmp/clrn-94-texas --frozen --no-install-project
PYTHONPATH=/tmp/clrn-94-texas/src /tmp/clrn-94-texas/.venv/bin/python e2e/reproductions/issue-94/backend_contract.py
```

只运行非余额业务错误的失败回归：

```sh
PYTHONPATH=/tmp/clrn-94-texas/src /tmp/clrn-94-texas/.venv/bin/python e2e/reproductions/issue-94/backend_contract.py BackendContract.test_business_conflict_preserves_reason
```

`ISSUE94_TEXAS_COMMIT` 可指定后续待验收的完整提交；导入源码的实际提交必须匹配，且已跟踪源码不得修改。版本与实测耗时、进程峰值常驻内存写入输出；逐例账本和消息写入 `e2e/test-results/issue-94/backend/`，可用 `ISSUE94_BACKEND_REPORT` 指定目录。

隔离边界为 FakeRedis、消息出口、钱包 HTTP 地址和可重复的随机牌堆种子。钱包 SDK、实际带入/入座/准备/双方 all-in、结算、自动补码、异常解析及钱包重试均保留。没有预先构造站起或补码消息。钱包服务仅绑定随机回环端口，采用独立账本，不连接远端；生产 SDK 的两秒超时真实等待，超时故障不使用 sleep mock。提交后丢回复使用同一交易编号的三次真实重试，检查只提交一次；这只证明本地账本与 SDK 单次调用的去重，**不证明线上钱包或跨页面重试幂等性**。

交易冲突的消息分支以 `DummyQueueMessage.send_room_public_messages` 和 `send_players_private_messages` 中实际转换后的协议内容为准，在再次入座、恢复前深复制到报告的 `messageExit`。私有消息按接收玩家分组，公共消息须含对应 `player_id`；每个实际钱包冲突请求的玩家都须在出口收到 `error_type=transaction_conflict`。仅在内部消息添加错误字段、转换时丢字段或只发给其他玩家均不能通过；向调用者抛出真实 `SDKException(transaction_conflict)` 的分支仍合法。该出口仍是隔离捕获，不证明真实网关或网页已收到消息。

断言自身可在同一固定德州环境中独立检查（包含真实 all-in、重新入座和恢复的坏修复负例）：

```sh
PYTHONPATH=/tmp/clrn-94-texas/src /tmp/clrn-94-texas/.venv/bin/python -m unittest discover -s e2e/reproductions/issue-94 -p test_backend_contract.py -v
```

这些工具自测中的正确出口内容为边界夹具，不是外部产品已修复的证据；原后端回归仍须对未修改的待测源码单独运行并如实返回失败。

## 工具检查与待补环境

```sh
e2e/.venv/bin/python -m unittest discover -s e2e/mitmproxy -p test_texas_faults.py -v
npm run check
```

完整金币链路仍需：本轮专属金币房间/匹配分组、合法独立出口或仅对该分组关闭同 IP 检查、版本可追溯的隔离德州服务、可配置的钱包回环依赖，以及真实消息网关投递。共享 staging 全局依赖和规则均不应修改。部署前需登记服务版本、钱包协议和消息契约，完成浏览器操作触发的自动补码及交易核对，再向 #95 交接正式验收。

## 2026-11-04 实测记录

应用 Release 为 `web-staging-200001602-b20853dbe65c`，完整应用提交 `b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`，构建包 SHA-256 为 `ca1f1b81e9a750e5a517287a6c1209be866d9d36cd408391f10f6eb7b40fbe87`。浏览器测试固定 CLRN `6c78b01fb28c8ad0b2cd170b83b0eb219d031a50`；全部运行源文件摘要已与该 Git 提交逐一核对。后端定向用例固定 CLRN `d938fea110d9dc7c0c81a25872fbadbe7cc023dd` 和上述德州源码版本。环境为 macOS arm64、Node 24.14.0、Playwright 1.61.1、mitmproxy 12.2.3/Python 3.12.0，隔离引擎为 Python 3.13.8，依赖来自该源码的冻结 `uv.lock`。

| 检查 | 实际结果 | 时间与内存 |
| --- | --- | --- |
| 浏览器主矩阵 13 场景 | 9 通过，3 条正确行为断言失败，1 条在账号准备阶段超时而未注入；无跳过、无自动重试 | 整个命令 596.78 秒，最大常驻内存 502202368 字节 |
| HTTP 非 JSON 定向补测 | 实际注入两次；可读提示断言失败，解除故障后的真实带入/入座和 100 筹码断言通过 | 整个命令 94.13 秒，最大常驻内存 442695680 字节 |
| 隔离后端 10 场景 | 9 通过，非余额业务原因丢失的正确行为断言失败 | 10.769 秒，Python 进程峰值常驻内存 63373312 字节 |
| 仓库与代理工具 | 全仓 lint/typecheck 通过，218 项 Node 测试通过；代理整套 80 项自测通过，其中新增 8 项 | 未单独测量内存 |

浏览器内存采用 macOS `/usr/bin/time -l` 的单命令观测值，不是全部进程 RSS 的合计。逐例耗时、错误及环境阻塞保存在 [客户端结果](evidence/client/results.json)，版本和内容指纹见 [构建清单](evidence/client/manifest.json)，后端指标与来源见 [后端运行记录](evidence/backend/run.json)。主矩阵的非 JSON 用例因设置测试钻石超时而未触发故障，定向补测单独保留，不将两轮拼成全绿。

本轮关键事实：

- WebSocket 缺失错误字段：显示 `undefined-sit`，两次故障期间重试均命中。解除后第三个命令收到真实 `ok=true`，带入并入座为 100。[关键帧](evidence/client/websocket-missing-fields/04-fault-video-frame-13s.png)、[恢复截图](evidence/client/websocket-missing-fields/05-recovered.png)、[登录后录像](evidence/client/websocket-missing-fields/signed-in.webm)、[命令时间线](evidence/client/websocket-missing-fields/scoped-rpc-timeline.json)。原脚本截图落在弹窗 300 毫秒入场动画中，关键帧取自同一原始录像第 13 秒，提取方式和原片摘要见同目录 `derived-frames.json`，没有绘制或修改页面内容。
- HTTP 缺失字段和非 JSON：真实带入接口命中故障，但可读错误提示断言失败；故障期间再次操作仍命中，解除故障后重新请求上游并恢复 100 筹码。[缺失字段录像](evidence/client/http-missing-fields/signed-in.webm)、[非 JSON 录像](evidence/client/http-invalid-json/signed-in.webm)、[非 JSON 请求时间线](evidence/client/http-invalid-json/scoped-http-timeline.json)。
- WebSocket 断连：第二次故障后自动重连并出现带入弹窗，40 秒窗口内没有预期的错误提示，按本任务要求保留失败；解除后新命令和实际入座恢复成功。此结果不能推断原事件根因。[录像](evidence/client/websocket-disconnect/signed-in.webm)、[时间线](evidence/client/websocket-disconnect/scoped-rpc-timeline.json)。
- 其他 HTTP 503/504、超时、断连及其他业务错误，以及 WebSocket 超时、非 JSON 帧和其他业务错误通过本轮错误提示、故障期间再次操作、解除故障后真实重试及筹码核对。完整范围以结果文件和本目录断言为准。
- 后端交易冲突：余额 9845、自动补码 155，实际结算后输出站起并吞掉冲突原因。紧接着调用真实入座包装器时**没有返回筹码不足错误**，而是输出 `prompt_buy_in`，没有新增钱包请求；手动带入后恢复。正常及冲突场景通过钱包与桌上筹码总额守恒检查。[完整账本及消息出口记录](evidence/backend/conflict.json)。这证实吞错路径，未复现原事件“重新入座报筹码不足”的完整现象。
- HTTP 503/504、断连和读取超时在后端引擎内产生的消息，与真正到达隔离消息出口的消息分别记录；不能把抛异常前准备好的站起消息当成已投递推送。提交后丢回复的账本确认实际扣款一次，仍不代表线上事务或跨页面重试已验证。

金币匹配前置检查仍失败，队列现场及真实大厅规则见 [截图](evidence/coin-prerequisite/03-matching-outcome.png) 和 [规则记录](evidence/coin-prerequisite/matching-prerequisites.json)。本轮没有建立成功的金币牌局。实际后端部署版本、完整隔离服务/网关、金币自动补码网页录像及线上钱包交易恢复继续由 #1648 补齐；#94 和 #95 均不能据此关闭。

本轮新建私人房间均由准确 UUID 删除，并等待实际退款到账；本工作区账号锁已释放。代理及临时证书由每例 finally 清理。提交的文本证据已针对本机账号池密码和测试令牌扫描，未包含凭据；没有保存原始网络 trace 或登录状态。

## 消息出口断言修复后的自检

本轮在未修改的固定德州版本上重新运行完整后端 10 场景，9 通过、交易冲突原因未到达故障玩家的断言失败；完整出口与再次入座记录见 [新冲突证据](evidence/backend-message-exit/conflict.json)。钱包余额不变、恢复后只新增一次扣款及 155 筹码的核对仍通过。耗时 10.694 秒，Python 峰值常驻内存 62996480 字节。

断言自测 9 项通过，包括真实 HTTP/SDK 异常分支和三个坏修复负例；将原始 `verify` 方法在内存中换回后，三个负例均能识别其误接受，修复后全部通过。全仓 lint/typecheck、218 项 Node 测试、80 项代理测试及 3 项真实 Chromium 动画子测试通过。当前未提交工作区的源码摘要、运行结果与验证边界见 [自检记录](evidence/backend-message-exit/run.json)；本轮没有重跑需要额外授权的 staging 浏览器矩阵，既有浏览器失败证据完整保留，合入门槛仍未满足。
