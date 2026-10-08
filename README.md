# 来玩 H5 E2E

已部署站点的 Playwright 端到端测试位于 [e2e/](e2e/README.md)，弱网故障由 mitmproxy 注入。GitHub Actions 在 E2E 代码或工作流 push 变更和手动触发时运行完整测试，结果见仓库的 Actions 页面。

线上 Web 视觉回归及运行说明位于 [visual/](visual/README.md)。当前执行 1200 张基准截图；视觉代码变更后 CI 将应用（简中核心 164 张）、德州（122 张）和拼三张（52 张）拆成独立任务并行运行，每天运行三语言全量。不需要应用源码或本地开发服务。

我的战绩、德州和拼三张视觉测试各使用独立代理脚本，仅和弱网 E2E 共用 mitmproxy 进程管理；其他 App 视觉测试直连。战绩覆盖新旧版、两种视口和三种语言，共 372 张截图，详见 [覆盖清单](visual/cases/game-record/COVERAGE.md)。德州截图里的 `0ms` 是固定文案，用于稳定截图；实际浏览器流量经过 `mitmdump`。

## 线上功能案例

默认测试入口为 `https://h5.page.shafayouxi.org/`。新增案例统一用 TypeScript，
按 [案例维护约定](e2e/cases/README.md) 将说明与 `test.spec.ts` 放在同一个目录。
运行 `cd e2e && npm ci && npm run test:functional`，不需要应用源码或本地开发服务。

功能案例涵盖认证、游客门禁、大厅入口、消息、个人设置、建房配置和创建流程，
详细范围与已知缺口见 [功能线盘点](e2e/cases/COVERAGE.md)。
实测同一账号再次登录后旧凭据失效，因此同账号的 CI 共用一个并发组；视觉德州和拼三张各使用独立固定测试账号，与应用部分并行执行。

运行 `cd visual && pnpm run lint` 或 `cd e2e && npm run lint` 可检查仓库 TypeScript/JavaScript 文件是否超过 400 行；CI 由独立的 lint 工作流在每次 push 时检查一次。
