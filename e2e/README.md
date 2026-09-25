# 来玩 H5 E2E

弱网测试使用 staging 测试账号。账号及权限记录在 [应用仓库的测试账号文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/testing/accounts.md)。

这是一个自包含的 npm 子项目，只通过 URL、DOM、`data-testid`、localStorage key、HTTP API 路径和环境变量测试已部署的 staging / production H5。它不构建应用，也不依赖仓库根目录的依赖、配置或源代码。

## 运行

所有命令均在 `e2e/` 目录执行：

```bash
cd e2e
npm ci
npx playwright install chromium # 本机首次安装或升级 Playwright 时执行

export E2E_STAGING_URL='https://staging.example.com/' # 替换为实际冒烟站点

npm run test:smoke
npm run test:network-resilience
npm test # 运行全部 E2E
npm run report
```

校验指定提交已经部署：

```bash
E2E_EXPECT_BUILD_SHA=abc1234 npm run test:smoke
```

必需环境变量：

- `E2E_STAGING_URL`：冒烟和弱网测试共同使用的 staging H5 地址。

可选环境变量：

- `E2E_WORKERS`：并行 worker 数，默认 `2`。
- `E2E_RETRIES`：失败重试次数，默认 `1`。
- `E2E_EXPECT_BUILD_SHA`：至少 7 位的提交 SHA 前缀。
- `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`：弱网俱乐部场景的 staging 测试账号。

## 覆盖范围

冒烟测试覆盖 `E2E_STAGING_URL` 指定的 staging 站点，以及 `https://h5.laiwan.life/`、`https://h5.laiwanpai.com/` 和 `https://h5.goplay360.com/`，检查 HTTP 状态、标题、应用根节点和首屏内容。设置 `E2E_EXPECT_BUILD_SHA` 后还会验证 `meta[name="build-version"]`。

弱网测试覆盖大厅接口超时、登录接口失败和俱乐部列表接口失败后的降级与重试 UI。失败 trace 保存在 `test-results/`，HTML 报告保存在 `playwright-report/`。

## 测试资产边界

需要调整测试账号资产时，只允许操作 staging：减少资产使用 `POST /v11/wallet/<user_id>/withdraw`，增加资产使用 `POST /service/v11/wallet/<user_id>/deposit`。`currency_name` 仅使用 `coin` 或 `diamond`，`amount` 为非负数，每次使用新的 UUID `transaction_id`。Production E2E 仅允许不会修改用户资产和业务数据的只读检查。

## CI

先在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中设置 `E2E_STAGING_URL`。`.github/workflows/e2e.yml` 在 `master` push 或手动触发时，将这个仓库变量传给测试，并使用 Playwright `v1.59.1-jammy` 镜像执行 `npm ci` 和 `npm test`。变量缺失或不是 HTTPS URL 时会直接报错。失败时上传 trace 与 HTML 报告。镜像版本与本目录 `package-lock.json` 锁定的 Playwright `1.59.1` 一致。测试访问已部署站点，push 触发的结果反映当时站点状态，不代表当前提交已经部署。可在部署后手动运行工作流，并用 `E2E_EXPECT_BUILD_SHA` 本地验证指定版本。

部署说明见 [应用仓库的 Web 文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/web/README.md)。
