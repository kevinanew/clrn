# 来玩 H5 E2E

已部署站点的 Playwright 端到端测试位于 [e2e/](e2e/README.md)，弱网故障由 mitmproxy 注入。GitHub Actions 在 E2E 代码或工作流 push 变更和手动触发时运行完整测试，结果见仓库的 Actions 页面。

线上 Web 视觉回归及运行说明位于 [visual/](visual/README.md)。当前执行 1398 张基准截图；视觉代码变更后 CI 将应用（简中核心 164 张）、德州（188 张）和拼三张（52 张）拆成独立任务并行运行，每天运行三语言全量。不需要应用源码或本地开发服务。

我的战绩、德州和拼三张视觉测试各使用独立代理脚本，仅和弱网 E2E 共用 mitmproxy 进程管理；其他 App 视觉测试直连。战绩覆盖新旧版、两种视口和三种语言，共 372 张截图，详见 [覆盖清单](visual/cases/game-record/COVERAGE.md)。德州截图里的 `0ms` 是固定文案，用于稳定截图；实际浏览器流量经过 `mitmdump`。

## 线上功能案例

默认测试入口为 `https://h5.page.shafayouxi.org/`。新增案例统一用 TypeScript，
按 [案例维护约定](e2e/cases/README.md) 将说明与 `test.spec.ts` 放在同一个目录。
运行 `cd e2e && npm ci && npm run test:functional`，不需要应用源码或本地开发服务。

功能案例涵盖认证、游客门禁、大厅入口、消息、个人设置、建房配置和创建流程，
详细范围与已知缺口见 [功能线盘点](e2e/cases/COVERAGE.md)。
实测同一账号再次登录后旧凭据失效。CI 使用 30 个专用账号，每个任务按运行 ID 分配账号，只有选到同一账号的任务排队；视觉全量矩阵的九个套件／语言任务使用九个不同账号。

仓库根目录运行 `npm ci && npm run check` 检查全部代码，详见下方检查说明。

## 本机并行测试账号池

并行运行本机测试时，用账号池启动脚本为每轮任务分配独立的 staging 账号：

```sh
cd e2e
node ../scripts/with-test-account.mjs -- npm run test:functional:existing

cd ../visual
node ../scripts/with-test-account.mjs -- pnpm run test:ci
```

本机账号池已扩容至 **30 个独立账号**，保留原有 6 个、新增 24 个。
所有账号均通过真实注册、登录和会话校验，并各准备 60 钻供建房测试；
新增账号还通过实际钱包读取确认余额。
脚本自动设置功能测试、创建测试和视觉测试的用户名及密码。所有 clrn worktree
共用 Git 元数据目录里的账号池与占用锁；任务结束后释放账号，失败退出也释放。
每组测试都应通过该脚本启动，同一轮内部仍保持现有测试的登录与 worker 策略。

账号凭据只保存在 Git 元数据目录 `clrn-test-accounts/accounts.json`，不提交。
可通过 `CLRN_TEST_ACCOUNT_POOL` 指定其他账号池文件；共用账号必须共用同一文件，
占用锁保存在其旁边的 `locks/`。池用完时明确报错，不复用正在被占用的账号。
进程被 SIGKILL 强制终止会留下占用锁，确认对应测试已结束后再删除该目录。
本机锁只协调本机任务。CI 另有 30 个专用账号，和本机池分开，避免跨机器登录冲突。

测试账号创建方式见相邻 PRD 的
[测试账号、余额与 Secret](https://github.com/kevinanew/laiwan_prd/blob/master/docs/API微服务开发规范.html#testing-data)：
使用 staging 专用测试注册接口，不受普通注册的 IP／设备限制；账号保留供后续测试复用。

验证账号分配与失败释放：`node --test scripts/with-test-account.test.mjs`。

仓库检查需要 Node.js 24 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)；在仓库根目录先执行 `npm ci`，再执行 `npm run check`。
`npm run lint` 检查根目录、`scripts/`、`e2e/`、`visual/` 中全部 JavaScript／TypeScript，函数、命名箭头函数、类及方法
必须有含有效说明的 TSDoc；已有参数必须写 `@param 参数名 - 说明`。
使用 `eslint-plugin-tsdoc` 校验格式，缺失注释、空注释、未知标签和不规范的
JSDoc 类型写法均会导致检查失败，警告也视为失败。
规则依据 [TSDoc 插件说明](https://tsdoc.org/pages/packages/eslint-plugin-tsdoc/)
及 [require-jsdoc 规则](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/require-jsdoc.md)。

检查还包括全部 Python 的 Ruff 规则、全部 Shell 的 ShellCheck、GitHub Actions 的 actionlint 和 JavaScript／TypeScript 的 400 行上限。
`npm run typecheck` 对全仓库 TypeScript 执行严格类型检查；`npm test` 自动收集全仓库 Node 单元测试。
依赖、虚拟环境及测试报告等生成文件不检查。线上 Playwright 案例由各自测试入口运行，静态检查和本机单元测试无需真实凭据。
actionlint 当前尚未识别 GitHub 已支持的 `concurrency.queue`，仅忽略这一条兼容性误报，其他工作流与内嵌 Shell 错误仍会失败。

GitHub Actions 在每次 push 和 PR 上运行同样的全仓库检查，包含 30 个任务的本机并发占用测试及 CI 账号分配验证。

## CI 专用账号池

已另行创建并验证 30 个 staging 账号 `clrnci26100901`–`clrnci26100930`，每个准备 60 钻。
完整凭据由仓库 Actions Secret **`CLRN_CI_TEST_ACCOUNTS`** 维护，结构为 `{ "accounts": [{ "username": "…", "password": "…", "status": "ready" }] }`；Git 中的 `scripts/ci-test-accounts.json` 只维护公开账号名。
本机恢复备份为 Git 元数据目录中的 `clrn-test-accounts/ci-accounts.json`，权限 0600。

E2E、功能与视觉工作流先规划账号，再以 `h5-staging-account-<用户名>` 作为 job 并发组。
GitHub 在 job 开始前取得账号锁，任务的所有步骤结束后释放；`queue: max` 保留等待任务。
运行 ID 决定轮转起点，视觉套件与语言使用不同偏移。同一轮九个视觉任务不会重复分配账号；跨轮次选中同一账号时仍需排队，分配器不会查询服务器在线状态。
不同账号的任务可以并行，实际任务数还受 GitHub runner 配额限制。缺少 Secret 或账号池不完整时直接失败。
凭据注入为 `E2E_TEST_*`、`E2E_CREATION_*` 和 `VISUAL_*`；旧的 CI 自定义玩法账号变量不再使用。
测试注册／补钻仍使用既有 `TESTING_API_TOKEN`，仅在 Node 进程中调用。

账号清单统一登记在 [PRD 账号池](https://github.com/kevinanew/laiwan_prd/blob/master/docs/测试与维护仓库.html#test-account-pool)，后续优先复用现有账号。
