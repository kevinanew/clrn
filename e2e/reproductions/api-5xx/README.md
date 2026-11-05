# HTTP 5xx 定向复现（CLRN #116）

只注入 HTTP 500–599。浏览器先实测 500／503 的 JSON 和非 JSON 错误页，观察是否出现
应用 [#5159](https://github.com/kevinanew/laiwan_react_native/issues/5159) 的
“玩家筹码不足-sit”，并记录真实错误提示及解除故障后的恢复。没有复现原提示就明确记录，
不把注入结果当作历史根因。本入口不测试超时、断连、余额、all-in 或隔离后端服务。

## 首轮实测结果（2026-11-06）

固定应用提交 `b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`，四个场景全部通过。
每例故障期间两次真实请求均收到指定 5xx；解除后收到上游 200 并入座 100 筹码。
**没有出现“玩家筹码不足-sit”，未复现原反馈，也未确认 5xx 是其原因。**

| 状态与内容 | 页面实际提示 | 故障／恢复截图 |
| --- | --- | --- |
| 500 JSON | Request failed with status code 500 + 接口路径 | [故障](evidence/500-json/5xx.png)／[恢复](evidence/500-json/recovered.png) |
| 500 HTML | Request failed with status code 500 + 接口路径 | [故障](evidence/500-html/5xx.png)／[恢复](evidence/500-html/recovered.png) |
| 503 JSON | Request failed with status code 503 | [故障](evidence/503-json/5xx.png)／[恢复](evidence/503-json/recovered.png) |
| 503 HTML | Request failed with status code 503 | [故障](evidence/503-html/5xx.png)／[恢复](evidence/503-html/recovered.png) |

[完整结果](evidence/results.json)和[构建及测试内容指纹](evidence/manifest.json)保留证据边界。
浏览器执行 97.1 秒，含构建准备 105.84 秒；最大 RSS 615497728 字节，不是并发进程内存合计。
静态检查、类型检查、276 项 Node 测试及 77 项代理测试通过。issue 和 PR 继续保持打开，
不能把这轮阴性结果写成原问题已修复。后续新增场景需保持本次约定的 5xx 范围。

## 运行

在仓库根目录安装 `npm ci` 和 `npm --prefix e2e ci`，使用既有 Chromium 和
`e2e/.venv` 的 mitmproxy（依赖见 `e2e/mitmproxy/requirements.txt`）。
通过环境提供 GitHub Release 读取凭据 `GITHUB_TOKEN` 和 `TESTING_API_TOKEN`，
本机测试令牌也可从 `CLRN_TESTING_DEPLOYMENT_FILE` 指定的既有 staging 部署文件读取。

```sh
node e2e/reproductions/api-5xx/run.mjs
node e2e/reproductions/api-5xx/run.mjs --grep '500 json'
e2e/.venv/bin/python -m unittest discover -s e2e/mitmproxy -p test_server_errors.py -v
```

启动器校验本提交 `deployments/staging.json` 中固定的 Release，使用真实账号锁、正常
初始化和登录。后续验收可通过既有 `CLRN_RELEASE_RECORD` 提供精确的修复版本发布记录。
本轮输出在 `e2e/test-results/api-5xx/<run-id>/`，包含版本、实际提示、是否复现原提示、
真实 HTTP 状态时间线、稳定截图和 Playwright 的实际退出结果。默认不录像、不保存 trace。

## 场景与边界

通过真实页面创建私人记分牌桌、关闭带入审核，点击座位和确认带入，实际请求
`POST /v10/texas_holdem/room/<本轮 UUID>/buy_in/apply`。代理仅匹配该方法、准确路径、
真实 staging 节点和当前账号指纹，其他请求及 CORS 预检透传。管理指纹不进入报告。

故障响应只表达服务器错误，不包含“筹码不足”。每例核对浏览器收到的真实 500／503，
再次操作仍命中，解除后通过原入口取得真实成功回复并入座。原提示是否出现单独记录，
可读提示、错误分类和恢复按正确行为断言。没有预期失败、跳过或自动重试。
测试结束后解除故障、回收准确房间并释放代理和账号锁。

控制层独立覆盖 100 个 5xx 值的 JSON／HTML 返回、边界校验和准确隔离；浏览器不做
100 次重复流程。HTTP 带入实验不能冒充 WebSocket 入座 RPC 或服务端钱包调用的复现。

本入口使用独立 Playwright 配置，尚未加入默认套件。复现 PR 和 issue 保持打开；
应用修复并上传构建后，用原测试复验，通过再合并并长期保留。Refs #116。
