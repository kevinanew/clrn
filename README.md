# 来玩 H5 E2E

已部署站点的 Playwright 端到端测试位于 [e2e/](e2e/README.md)。GitHub Actions 在 `master` push 和手动触发时运行完整测试，结果见仓库的 Actions 页面。

Web 视觉回归测试、276 张基准图及本地运行说明位于 [visual/](visual/README.md)。GitHub Actions 在非 `release` 分支的 push 时运行简中核心场景，每天运行全部语言与场景。

## 线上功能案例

默认测试入口为 `https://h5.page.shafayouxi.org/`。新增案例统一用 TypeScript，
按 [案例维护约定](e2e/cases/README.md) 将说明与 `test.spec.ts` 放在同一个目录。
运行 `cd e2e && npm ci && npm run test:functional`，不需要应用源码或本地开发服务。

已覆盖游客导航、登录表单、不同设备再次登录、同设备再次登录。
实测同一账号再次登录后旧凭据失效，因此账号相关 CI 共用一个并发组，按顺序执行。
