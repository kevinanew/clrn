# 入座 API 5xx 复现与修复验证（CLRN #116）

本入口只验证 `PUT /v10/texas_holdem/room/<本轮房间>/sit` 下游返回 **500–599** 时的
错误弹窗、取消、同座位主动重试和解除故障后的正常入座。浏览器选择 500／503 × JSON／HTML，
不扩展到余额、all-in、4xx、断连或钱包服务。

原反馈：[laiwan_react_native #5159](https://github.com/kevinanew/laiwan_react_native/issues/5159)。
本轮使用未修复 master 的真实 Release 页面，不修改应用源码、组件状态或初始化流程。
应用修复 PR 未合并时，不能把旧版测试通过当作修复完成。

## 旧 master 实测结果（2026-11-07）

四个场景均失败，实际退出码为 1；**只有错误提示断言失败**，每例首次失败及主动重试各一次。
正常对照、三次实际 5xx、取消、同座位重试、解除故障后的新成功回复和入座 100 筹码均完成；
未处理页面异常为 0。没有跳过、预期失败标记或自动重跑。

| API 响应 | 旧版实际提示 | 首次故障／重试／恢复 |
| --- | --- | --- |
| 500 JSON | 服务内部异常-sit | [故障](evidence/sit-legacy/500-json/sit-error-1.png)／[重试](evidence/sit-legacy/500-json/sit-error-2.png)／[恢复](evidence/sit-legacy/500-json/recovered.png) |
| 500 HTML | Cannot destructure property 'ok' of 'i' as it is null.-sit | [故障](evidence/sit-legacy/500-html/sit-error-1.png)／[重试](evidence/sit-legacy/500-html/sit-error-2.png)／[恢复](evidence/sit-legacy/500-html/recovered.png) |
| 503 JSON | 服务内部异常-sit | [故障](evidence/sit-legacy/503-json/sit-error-1.png)／[重试](evidence/sit-legacy/503-json/sit-error-2.png)／[恢复](evidence/sit-legacy/503-json/recovered.png) |
| 503 HTML | Cannot destructure property 'ok' of 'i' as it is null.-sit | [故障](evidence/sit-legacy/503-html/sit-error-1.png)／[重试](evidence/sit-legacy/503-html/sit-error-2.png)／[恢复](evidence/sit-legacy/503-html/recovered.png) |

应用为未修复 master `b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`，Release
`web-staging-200001602-b20853dbe65c`。浏览器耗时 122.4 秒，含准备 134.45 秒，
最大 RSS 583712768 字节（非并行进程内存合计）。
[结构化结果及证据摘要](evidence/sit-legacy/results.json)、[构建／测试指纹](evidence/sit-legacy/manifest.json)、
[网关原版源码指纹](evidence/sit-legacy/gateway.json)和各例 `sit-events.json` 均保留。
记录的 CLRN HEAD 是取证前提交，实际测试内容由源码 SHA256 固定，并已与本次提交文件核对。

**已重现原有入座错误弹窗；没有重现历史“玩家筹码不足-sit”的确切文字，也未证明那次资金事件的根因。**

## 为什么之前没有出现弹窗

先前测试的是 `POST .../buy_in/apply`，该 HTTP 失败走带入错误处理；原截图则来自更早的
`PUT .../sit`，经 WebSocket RPC 和网关调用下游 API。之前遗漏了实际入座边界。
旧 HTTP 实验的原始[结果](evidence/results.json)、[构建指纹](evidence/manifest.json)和截图保留，
仅供核对历史，不能作为入座缺陷未出现或已修复的证据。原 HTTP 浏览器场景已由入座场景替换。

## 已定位的错误链

旧版入座未指定 `v2`：原网关的 `build_rpc_result` 在 legacy 分支直接返回 JSON，丢失下游
HTTP 状态；遇到 HTML 时 `current_service_error_rpc_result` 返回空值。客户端因此分别暴露
后端原文加 `-sit`，或对空数据解构失败的内部异常；旧版 `_sitDown` 又直接把错误消息交给弹窗。
这说明入座 5xx 的错误展示有缺陷，但不能据此推断历史资金状态或“筹码不足”的服务端成因。

## 运行

安装 `npm ci`、`npm --prefix e2e ci`、Chromium 和 `e2e/.venv` 的 mitmproxy
（依赖见 `e2e/mitmproxy/requirements.txt`）。提供 `GITHUB_TOKEN`、`TESTING_API_TOKEN`；
本机也可通过 `CLRN_TESTING_DEPLOYMENT_FILE` 从既有 staging 部署文件读取测试令牌。

另外准备未修改的 `kevinanew/centrifugo_gateway_flask` 源码，固定提交
`e9be071eff77e1c767e63e36288935830b6dc6d3`，并按该仓库依赖准备 `.venv/bin/python`。
设置 `CLRN_GATEWAY_SOURCE_ROOT` 为源码根目录；默认查找 `~/github/kevinanew/centrifugo_gateway_flask`。
启动器校验提交和源码改动，只在本轮进程加载原始 Blueprint，退出后回收本机服务器及私有日志。

```sh
node e2e/reproductions/api-5xx/run.mjs
node e2e/reproductions/api-5xx/run.mjs --grep '500 json'
e2e/.venv/bin/python -m unittest discover -s e2e/mitmproxy -p 'test_*server_errors.py' -v
```

默认下载并校验 `deployments/staging.json` 固定的应用 Release。后续通过既有
`CLRN_RELEASE_RECORD` 指定精确的修复构建，用同一份测试复验。
每轮输出 `e2e/test-results/api-5xx/<run-id>/`：应用版本和 SHA256、测试源码指纹、
网关源码指纹、实际 RPC 时间线、页面原始提示和稳定截图。默认无 trace、录像或登录截图。

## 故障如何到达真实应用

Python mitmproxy 只匹配真实 staging 来源、本轮账号指纹、确切房间和 `PUT sit` 命令，
其他请求、订阅和心跳透传。TypeScript 只驱动真实页面、控制故障与断言，不使用 Playwright route。

故障中的原始 RPC 请求送到本机固定版本网关的真实 HTTP 入口；网关通过 `requests.request`
访问本机目标 API，该 API 实际返回指定的 500／503 JSON 或 HTML。响应状态在实际 HTTP
响应处观察，解析及 legacy／v2 封装均由未修改的网关源码完成，再附原命令编号交回原页面。
不手工构造应用错误信封，不注入“筹码不足”，不直接构造 ResponseError。
这是隔离的本机网关，不会修改共享 staging 后端或启动完整业务服务栈。

正常对照与恢复透传真实 staging。旧 RPC 协议不携带下游 HTTP 状态时记录 `null`，
只根据真实 `ok: true` 和页面状态判定成功，不编造 HTTP 200。

## 页面步骤与正确预期

1. 使用既有账号锁、正常初始化和登录，通过页面建私人记分桌并关闭带入审核。
2. 无故障时从座位入口验证真实入座成功并截图；在同一房间通过菜单站起。
3. 启用本轮入座 5xx，点击空座位，确认网关下游实际返回指定状态，保存真实弹窗截图和文字。
4. 按正确行为断言提示为“网络有点问题，请重试”，保留旧版失败，不 skip、不 xfail、不自动重跑。
5. 点击取消，确认没有自动重发；再次选座，再点弹窗重试，确认三次请求均为同一座位、相同 5xx。
6. 解除故障，点击原弹窗重试，必须收到**新的**真实成功回复并正常入座，保存恢复截图。
7. 全程捕获未处理页面异常；故障前对照异常立即终止；finally 清理准确房间、代理及账号锁。

控制层覆盖全部 100 个 5xx 值的两种格式并拒绝范围外值。RPC 层验证账号／路径／方法／来源
隔离、真实回复关联和原版网关回复透传。浏览器只执行上述四个有代表性的场景。

## 修复与关闭条件

CLRN 先保留红色复现测试及真实截图；然后在 laiwan_react_native 修复并上传构建；
CLRN 使用修复构建运行**原故障、原操作和原断言**，全部通过后合并并保留长期回归。
合并后确认实际运行结果，再关闭 #116。应用仍可能显示正常的可读网络错误；不应继续暴露
后端原文／内部异常，也不能静默失败。

本 PR 保持草稿，issue 保持打开，使用 Refs #116，避免自动关闭。
