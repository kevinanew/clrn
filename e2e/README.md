# 来玩 H5 E2E

弱网测试使用 staging 测试账号。账号及权限记录在 [应用仓库的测试账号文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/testing/accounts.md)。

这是一个自包含的 npm 子项目，只通过 URL、DOM、`data-testid`、localStorage key、HTTP API 路径和环境变量测试已部署的 staging / production H5。它不构建应用，也不依赖仓库根目录的依赖、配置或源代码。

## 运行

所有命令均在 `e2e/` 目录执行：

```bash
cd e2e
npm ci
npx playwright install chromium # 本机首次安装或升级 Playwright 时执行

export E2E_STAGING_URL='https://h5.page.shafayouxi.org/' # 默认值，可省略

npm run test:smoke
npm run test:network-resilience
npm test # 冒烟与弱网测试
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

## 覆盖范围

冒烟测试覆盖 `E2E_STAGING_URL` 指定的 staging 站点，以及 `https://h5.laiwan.life/`、`https://h5.laiwanpai.com/` 和 `https://h5.goplay360.com/`，检查 HTTP 状态、标题、应用根节点和首屏内容。设置 `E2E_EXPECT_BUILD_SHA` 后还会验证 `meta[name="build-version"]`。

弱网测试覆盖大厅接口超时、登录接口失败和俱乐部列表接口失败后的降级与重试 UI。失败 trace 保存在 `test-results/`，HTML 报告保存在 `playwright-report/`。

## 测试资产边界

测试资产由授权人员在仓库外维护；本公开仓库和 CI 不保存或执行资产补充代码。
创建案例只检查 staging 专用账号的余额前置条件。Production E2E 仅允许不会修改用户资产和业务数据的只读检查。

## CI

先在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中设置 `E2E_STAGING_URL`。`.github/workflows/e2e.yml` 在 `master` push 或手动触发时，将这个仓库变量传给测试，并使用 Playwright `v1.59.1-jammy` 镜像执行 `npm ci` 和 `npm test`。变量缺失时使用默认线上 staging；非 HTTPS 或非 staging 域名会直接报错。失败时上传 trace 与 HTML 报告。镜像版本与本目录 `package-lock.json` 锁定的 Playwright `1.59.1` 一致。测试访问已部署站点，push 触发的结果反映当时站点状态，不代表当前提交已经部署。可在部署后手动运行工作流，并用 `E2E_EXPECT_BUILD_SHA` 本地验证指定版本。

部署说明见 [应用仓库的 Web 文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/web/README.md)。

## 功能案例与账号互斥

新增用户场景按 [cases/README.md](cases/README.md) 的约定添加，全用 TypeScript。
每个场景有说明及测试，桌面与手机串行执行，认证用例关闭 trace 和截图。

2026-09-26 实测不同设备再次登录后旧会话账户接口立即返回 401，新会话为 200。
因此功能、弱网、视觉 CI 共用 `h5-staging-test-account` 并发组。不同工作流不能同时登录同一账号。
三个工作流均设置 `queue: max`，允许最多 100 个运行排队；仅设置
`cancel-in-progress: false` 仍会让新运行替换已有的等待任务。
本机运行也应依次执行；GitHub 并发组不能锁住人工登录或其他仓库的运行。
固定账号的认证回归在账号不存在时会阻止自动注册并失败。
凭据可通过既有 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` 覆盖。

只读浏览案例使用 `signedInAccount` fixture，每例登录已有测试账号，禁止自动注册。

[自动注册案例](cases/auth-007-auto-registration/README.md) 单独验证真实注册与奖励：
每轮最多注册一个 staging 账号，桌面和手机恢复该会话，不重复注册。
注册失败不会重试或退回旧账号。其会话暂存在系统临时目录（目录 0700，文件 0600），
正常结束包括测试失败时自动删除，不进入 Git 或报告；强制杀进程时可能需手动清理。

创建案例使用已准备好的独立 staging 账号，通过 `E2E_CREATION_USERNAME` /
`E2E_CREATION_PASSWORD` 提供凭据；本机也可通过 `E2E_CREATION_STORAGE_STATE_FILE`
指定仓库外的登录状态文件。账号缺失或余额不足会明确失败，不自动补充资产。
2026-09-26 实测注册奖励为 50 钻，私人局需要 10 钻并在未开始时解散全额退款，
创建俱乐部消耗 50 钻，俱乐部内建局另需 10 钻。完整双视口创建组至少准备 210 钻，
其中 200 钻用于四次俱乐部创建，未开始牌局解散后退还其费用。

功能 CI 从仓库 Actions Secrets 注入 `E2E_CREATION_USERNAME` 和
`E2E_CREATION_PASSWORD`，从 Actions Variables 读取 `E2E_STAGING_URL`。
运行前检查两个 Secret 是否齐全；缺失会直接失败并列出配置名，不跳过创建用例。
在仓库 Settings → Secrets and variables → Actions 配置凭据，勿写入代码或报告。
每轮完整测试会消耗 200 钻，后续运行仍需由环境维护者保证余额前置条件。

完整功能线盘点及剩余限制见 [COVERAGE.md](cases/COVERAGE.md)。
