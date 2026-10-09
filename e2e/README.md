# 来玩 H5 E2E

弱网测试使用 staging 测试账号。账号及权限记录在 [应用仓库的测试账号文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/testing/accounts.md)。

这是一个自包含的 npm 子项目，只通过 URL、DOM、`data-testid`、localStorage key、HTTP API 路径和环境变量测试已部署的 staging / production H5。它不构建应用，也不依赖仓库根目录的依赖、配置或源代码。

## 运行

所有命令均在 `e2e/` 目录执行：

```bash
cd e2e
npm ci
npx playwright install chromium # 本机首次安装或升级 Playwright 时执行
python3.12 -m venv .venv # 弱网测试需要 Python 3.12+ 和 mitmproxy
.venv/bin/python -m pip install -r mitmproxy/requirements.txt

export E2E_STAGING_URL='https://h5.page.shafayouxi.org/' # 默认值，可省略

npm run test:smoke
npm run test:network-resilience
npm run test:mitmproxy # 无需访问 staging 的代理集成检查
npm test # 冒烟、弱网和测试余额 helper 回归
npm run test:functional # cases/ 下的 TypeScript 用户场景
npm run report
```

校验指定提交已经部署：

```bash
E2E_EXPECT_BUILD_SHA=abc1234 npm run test:smoke
```

目标站点：

- `E2E_STAGING_URL`：默认 `https://h5.page.shafayouxi.org/`，也允许旧 staging 域名 `h5.shafayouxi.org`；拒绝本地环境和其他域名。

可选环境变量：

- `E2E_WORKERS`：并行 worker 数，默认 `2`。
- `E2E_RETRIES`：失败重试次数，默认 `1`。
- `E2E_EXPECT_BUILD_SHA`：至少 7 位的提交 SHA 前缀。
- `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`：弱网俱乐部场景的 staging 测试账号。
- `E2E_MITMDUMP_PATH`：已有 mitmdump 可执行文件的路径；默认 `e2e/.venv/bin/mitmdump`。
- `MITMDUMP_PATH`：E2E 与德州视觉测试共用的可执行文件覆盖，优先于 `E2E_MITMDUMP_PATH`。

## 覆盖范围

冒烟测试覆盖 `E2E_STAGING_URL` 指定的 staging 站点，以及 `https://h5.laiwan.life/`、`https://h5.laiwanpai.com/` 和 `https://h5.goplay360.com/`，检查 HTTP 状态、标题、应用根节点和首屏内容。设置 `E2E_EXPECT_BUILD_SHA` 后还会验证 `meta[name="build-version"]`。

弱网测试覆盖大厅接口超时、登录接口失败和俱乐部列表接口失败后的降级与重试 UI，并确认俱乐部重试会再次发出请求。失败 trace 保存在 `test-results/`，HTML 报告保存在 `playwright-report/`。

弱网流量经过真实 mitmproxy，不使用 Playwright route 模拟网络故障。
每例自动启动独立的 `mitmdump`，仅监听本机随机端口；大厅首个请求延迟 12 秒后断连，
后续回退请求直接断连，登录和俱乐部目标接口直接断连。故障仅匹配 staging API，
放行 CORS 预检及其他请求；大厅和俱乐部解除故障后会检查真实接口恢复。
登录失败场景由代理返回“用户名已存在”，保留原用例分支并避免自动注册，再断开登录接口。
代理控制接口使用每例随机 token，故障命中次数通过该接口断言。
代理 CA 和私钥存放在系统临时目录，结束时删除；只有弱网与代理集成测试的浏览器上下文
忽略证书错误，不修改系统证书信任。代理不保存 flow 或输出请求正文，避免记录登录凭据。
本机可运行 `.venv/bin/python -m unittest discover -s mitmproxy -p 'test_*.py'`
验证故障范围、首次延迟、控制认证和清除故障。

代理公共代码分为 `helpers/mitmproxy-process.ts`（启动与停止）、
`helpers/mitmproxy-client.ts`（故障控制与计数）和 `helpers/mitmproxy-session.ts`
（临时证书与清理）。`helpers/mitmproxy.ts` 只负责 Playwright fixture。
德州视觉测试复用这些纯 Node 模块，不依赖 E2E 的 Playwright 版本或 node_modules。

## 测试资产边界

创建案例在每例开始前调用 staging `POST /public/v1/wallet/<user_id>/set_balance/testing`，
通过 `X-Testing-Api-Token` 请求头传递 token，JSON 请求体包含 `currency_name` 和 `balance`。
将专用账号设为 60 钻，再通过真实钱包读取确认。仅初始化时设置余额，保留业务扣费和退款断言。
Production E2E 仅允许不会修改用户资产和业务数据的只读检查。

## CI

先在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中设置 `E2E_STAGING_URL`。`.github/workflows/e2e.yml` 在 `e2e/**` 或工作流文件 push 变更及手动触发时，将这个仓库变量传给测试，并使用 Playwright `v1.59.1-jammy` 镜像执行 `npm ci`、安装 Python 3.12 与锁定的 mitmproxy，再运行代理检查和 `npm test`。变量缺失时使用默认线上 staging；非 HTTPS 或非 staging 域名会直接报错。失败时上传 HTML 报告；真实账号登录请求含私有凭据，因此关闭网络 trace。镜像版本与本目录 `package-lock.json` 锁定的 Playwright `1.59.1` 一致。测试访问已部署站点，push 触发的结果反映当时站点状态，不代表当前提交已经部署。可在部署后手动运行工作流，并用 `E2E_EXPECT_BUILD_SHA` 本地验证指定版本。

部署说明见 [应用仓库的 Web 文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/web/README.md)。

## 功能案例与账号互斥

新增用户场景按 [cases/README.md](cases/README.md) 的约定添加，全用 TypeScript。
每个场景有说明及测试，桌面与手机串行执行，认证用例关闭 trace 和截图。

2026-09-26 实测不同设备再次登录后旧会话账户接口立即返回 401，新会话为 200。
CI 因此使用 30 个专用账号，功能、弱网与视觉任务按运行 ID 分配账号。
每个 job 使用 `h5-staging-account-<用户名>` 并发组，只让同账号任务互斥，其他任务可以同时执行。
上述工作流/任务均设置 `queue: max`，允许最多 100 个运行排队；仅设置
`cancel-in-progress: false` 仍会让新运行替换已有的等待任务。
本机并行任务使用根目录 [账号池启动脚本](../README.md#本机并行测试账号池)，另有 30 个账号；GitHub 并发组不能锁住人工登录或其他仓库的运行。
固定账号的认证回归在账号不存在时会阻止自动注册并失败。
凭据可通过既有 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` 覆盖。

只读浏览案例使用 `signedInAccount` fixture，每例登录已有测试账号，禁止自动注册。

[测试注册案例](cases/auth-007-auto-registration/README.md) 使用专用 token 创建账号，再通过真实界面登录：
每轮最多创建一个 staging 账号，验证初始钻石为 0；桌面和手机恢复该会话，不重复注册。
注册失败不会重试或退回旧账号。其会话暂存在系统临时目录（目录 0700，文件 0600），
正常结束包括测试失败时自动删除，不进入 Git 或报告；强制杀进程时可能需手动清理。

创建案例使用已准备好的独立 staging 账号，通过 `E2E_CREATION_USERNAME` /
`E2E_CREATION_PASSWORD` 提供凭据；本机也可通过 `E2E_CREATION_STORAGE_STATE_FILE`
指定仓库外的登录状态文件。账号缺失或设置余额失败会明确失败。
2026-09-26 实测注册奖励为 50 钻，私人局需要 10 钻并在未开始时解散全额退款，
创建俱乐部消耗 50 钻，俱乐部内建局另需 10 钻。每个创建用例（含桌面和手机）独立重设 60 钻，
未开始牌局解散后退还其费用。

功能 CI 从 `CLRN_CI_TEST_ACCOUNTS` Secret 按所选用户名注入 `E2E_TEST_*` 和 `E2E_CREATION_*`，
从 Secret 读取 `TESTING_API_TOKEN`，从 Actions Variables 读取 `E2E_STAGING_URL`。
账号池必需；scope=all 额外检查创建凭据和 token，scope=registration 检查 token；缺失明确失败。
在仓库 Settings → Secrets and variables → Actions 配置凭据，勿写入代码或报告。
`TESTING_API_TOKEN` 与 staging 部署的 `test-api-token` Secret 一致。
本机优先读取环境变量；未设置且非 CI 时，从相邻
`../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml` 的 `stringData.token` 读取。
不会将 token 写入代码、浏览器或报告；请求禁止重定向，并检查 HTTP 状态和业务响应。
测试注册与只读案例不使用此余额初始化。测试注册接口不发放奖励。

完整功能线盘点及剩余限制见 [COVERAGE.md](cases/COVERAGE.md)。

2026-10-09 从应用仓库迁入去重后的 14 个补充业务场景（桌面／手机 28 项），
沿用以上已有账号及串行执行约定，不再维护独立 business 套件。
金币入口的已知产品错页保留预期失败回归，细节见 [SETTINGS-010](cases/settings-010-coin-mall-entry/README.md)。
