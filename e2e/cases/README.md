# 线上浏览器案例

沿用 cliw 的案例组织方式：每个用户场景一个目录，包含 `README.md` 与 `test.spec.ts`。
新增测试与共享辅助代码统一使用 TypeScript。只访问已部署的 HTTPS 站点，不启动应用开发服务器。

## 运行

```bash
cd e2e
npm ci
npx playwright install chromium
npm run test:functional
npm run test:functional -- auth-001-login-form
```

默认站点为 https://h5.page.shafayouxi.org/，可用 `E2E_STAGING_URL` 指定已部署的 staging。
桌面与手机使用独立浏览器上下文，统一串行执行，不共享浏览器登录状态。

## 新增案例

1. 创建 `<功能>-<三位编号>-<场景>/`，编号不重复使用。
2. 用中文说明目的、前置条件、步骤与预期、定位契约和关联问题。
3. 在 `test.spec.ts` 中按准备、操作、断言编写 `test.step()`。
4. 使用 `getByTestId()`，当前可见页面内的唯一目标先断言数量；缺少定位时明确失败。
5. 仅在真实重复时把共用准备流程提取到 `_shared/`，业务断言留在案例内。
6. 不进行充值、扣款、注册、改密或创建业务数据。登录场景使用已存在的 staging 测试账号。

## 报告

HTML 报告位于 `e2e/playwright-report/cases/`；失败截图位于 `e2e/test-results/cases/`。
报告和登录状态不提交 Git；功能测试关闭网络 trace，避免保存登录凭据。
CI 使用同一并发组串行运行功能测试，避免多轮登录互相影响。
