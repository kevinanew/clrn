# 来玩 H5 E2E

已部署站点的 Playwright 端到端测试位于 [e2e/](e2e/README.md)，弱网故障由 mitmproxy 注入。GitHub Actions 在 E2E 代码或工作流 push 变更和手动触发时运行完整测试，结果见仓库的 Actions 页面。

## 应用部署联动

`laiwan_react_native` 的 `master` 完成 staging Web 部署后，向本仓库 `master`
提交 `deployments/staging.json`，字段为 `environment: "staging"`、`sha`（40 位应用提交编号）
和 `deployed_at`（部署时间）。文件由发布流水线创建，不需要维护占位记录。
`.github/workflows/staging-deployment.yml` 读取记录，调用现有四组工作流：
站点与弱网、现有账号功能、交互与 Freshchat、简中核心视觉。创建账号、俱乐部和牌局的手动范围保持原入口，
三语言全量视觉保持每日运行。

`scripts/staging-deployment.mjs` 在每个测试任务前最多等待 10 分钟，要求 staging 的
`meta[name="build-version"]` 对应指定提交；测试后再次读取，发现版本被覆盖就失败。
站点冒烟中的正式站不使用 staging 的版本断言。代码 push、定时和手动测试维持现有行为，
只有部署调用传入版本约束。

四组工作流共用部署运行编号，视觉使用账号槽位 0–8，站点、功能、交互分别使用 9、10、11；
跨运行仍通过账号并发锁排队。部署入口使用 GitHub 的
[排队并发配置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
保留等待运行，应用仓库也将发布与验证串行，避免连续部署互相覆盖。
上游按本次部署记录的 CLRN 提交查询此入口，失败、取消、跳过、权限错误或超过 90 分钟均失败。

启用时先合入本仓库，再在应用仓库 Woodpecker 配置 `clrn_contents_token`
（仅需本仓库 Contents 读写、Actions 读取），最后启用应用仓库的通知步骤。
该联动覆盖 staging Web，测试失败时已发布的应用不会自动回滚。

2026-10-14 本机验收：全仓检查及 95 项本机单元测试通过；真实站点版本为
`0e028b8c2c4fa6e965fbed6036e2c525d57529c1`，尚不能代表应用最新提交的结果。
下面记录 `/usr/bin/time -l` 的整条命令耗时和最大驻留内存，内存不是并行进程树的总和。

| 回归范围 | 结果 | 耗时 | 最大驻留内存 |
| --- | --- | --- | --- |
| 站点与弱网 | 50 项通过，显式核对 staging 版本 | 252 秒 | 222.5 MiB |
| 现有账号功能 | 106 项；金币入口 2 项已知预期失败，账号准备 1 项重试通过，其余通过 | 1399 秒 | 336.3 MiB |
| 桌面与触屏交互 | 14 项通过 | 174 秒 | 255.7 MiB |
| 真实 Freshchat | 2 项通过 | 59 秒 | 224.2 MiB |

首轮弱网测试因本机缺少 mitmproxy 失败，按现有 requirements 安装后完整复测通过。
核心视觉三组均通过，见 [Actions 运行记录](https://github.com/kevinanew/clrn/actions/runs/38527002219)。
视觉使用远端现有 master，以上结果不替代新联动工作流合入后的首次真实部署验收；
没有更新截图基准、跳过新增失败或修改金币入口的预期失败标记。

线上 Web 视觉回归及运行说明位于 [visual/](visual/README.md)。当前执行 1404 张基准截图；视觉代码变更后 CI 将应用（简中核心 164 张）、德州（190 张）和拼三张（52 张）拆成独立任务并行运行，每天运行三语言全量。不需要应用源码或本地开发服务。

我的战绩、德州和拼三张视觉测试各使用独立代理脚本，仅和弱网 E2E 共用 mitmproxy 进程管理；其他 App 视觉测试直连。战绩覆盖新旧版、两种视口和三种语言，共 372 张截图，详见 [覆盖清单](visual/cases/game-record/COVERAGE.md)。德州截图里的 `0ms` 是固定文案，用于稳定截图；实际浏览器流量经过 `mitmdump`。

## 线上功能案例

默认测试入口为 `https://h5.page.shafayouxi.org/`。新增案例统一用 TypeScript，
按 [案例维护约定](e2e/cases/README.md) 将说明与 `test.spec.ts` 放在同一个目录。
运行 `cd e2e && npm ci && npm run test:functional`，不需要应用源码或本地开发服务。

功能案例涵盖认证、游客门禁、大厅入口、消息、个人设置、建房配置和创建流程，
详细范围与已知缺口见 [功能线盘点](e2e/cases/COVERAGE.md)。
实测同一账号再次登录后旧凭据失效。CI 使用 100 个专用账号，每个任务按运行 ID 分配账号，只有选到同一账号的任务排队；视觉全量矩阵的九个套件／语言任务使用九个不同账号。

滚动、触屏交互及真实 Freshchat 客服回归统一位于 [e2e/interactions](e2e/INTERACTIONS.md)，
测试账号及权限统一见 [e2e/accounts.md](e2e/accounts.md)。

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
当前两组账号均使用独立的 16 位密码；H5 密码输入框上限为 20 位，分配器会拒绝超长密码。
可通过 `CLRN_TEST_ACCOUNT_POOL` 指定其他账号池文件；共用账号必须共用同一文件，
占用锁保存在其旁边的 `locks/`。池用完时明确报错，不复用正在被占用的账号。
进程被 SIGKILL 强制终止会留下占用锁，确认对应测试已结束后再删除该目录。
本机锁只协调本机任务。CI 清单共 100 个账号，Web 固定使用老 30 个，另外 70 个归 clrn-az，和本机池分开，避免跨机器登录冲突。
本机启动器会拒绝 CI 专用账号，即使通过自定义账号池文件传入也不能借用。

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

公开清单保留全部 100 个 CI 账号，防止本机工具误用；本仓库只调度老 30 个 `clrnci26100901`–`clrnci26100930`。新 70 个 `clrnci261015001`–`clrnci261015070` 专供 [clrn-az](https://github.com/albitsj/clrn-az) 使用。两个仓库的账号分区固定且互不重叠；GitHub concurrency 只在单个仓库内生效。
完整凭据由仓库 Actions Secret **`CLRN_CI_TEST_ACCOUNTS_V2`** 维护，结构为 `{ "accounts": [{ "username": "…", "password": "…", "status": "ready" }] }`；Git 中的 `scripts/ci-test-accounts.json` 只维护公开账号名。
旧的 `CLRN_CI_TEST_ACCOUNTS` Secret 保留 30 个账号，供尚未切换的旧分支及历史任务使用；本仓库兼容包含老 30 个或完整 100 个账号的 V2 Secret，但仅允许注入 Web 分区账号。
本机恢复备份为 Git 元数据目录中的 `clrn-test-accounts/ci-accounts-v2.json`，权限 0600。

E2E、功能、交互与 Freshchat、视觉工作流先规划账号，再以 `h5-staging-account-<用户名>` 作为 job 并发组。
GitHub 在 job 开始前取得账号锁，任务的所有步骤结束后释放；`queue: max` 保留等待任务。
运行 ID 决定轮转起点，视觉套件与语言使用不同偏移。同一运行编号下，九个 Web 视觉任务、三个其他 Web 回归任务和三个动画回归任务共 15 个槽位，不会重复分配账号；跨轮次选中同一账号时仍需排队，分配器不会查询服务器在线状态。
不同账号的任务可以并行，实际任务数还受 GitHub runner 配额限制。缺少 Secret 或账号池不完整时直接失败。
Web 视觉矩阵优先创建德州、拼三张任务（包含本轮选中的全部语言），再创建其他业务任务，以减少长任务排在末尾的等待。实际启动仍受 runner 和账号锁可用性影响；任务顺序不改变账号槽位或并行机制。
同一账号的测试保持一个 worker，账号级锁覆盖任务全部步骤；静态检查和单元测试不占用真实账号，可以并行。
CI 凭据注入只允许在 `kevinanew/clrn` 执行；`laiwan_react_native` 的部署任务只通知 CLRN，不读取或登录这些账号。
禁止在主应用、其他仓库或人工调试中借用本仓库分区的 CI 账号。主应用需要真实登录测试时应使用自己的独立账号。
视觉任务按账号派生稳定的设备标识，登录态采集与场景使用相同标识，不同账号不再共用固定设备。
凭据注入为 `E2E_TEST_*`、`E2E_CREATION_*` 和 `VISUAL_*`；旧的 CI 自定义玩法账号变量不再使用。
测试注册／补钻仍使用既有 `TESTING_API_TOKEN`，仅在 Node 进程中调用。

账号清单统一登记在 [PRD 账号池](https://github.com/kevinanew/laiwan_prd/blob/master/docs/测试与维护仓库.html#test-account-pool)，后续优先复用现有账号。

## Android Staging 视觉回归

原生安卓测试、下载脚本、模拟器工作流和全部 763 张截图基准已迁至 [albitsj/clrn-az 的 master](https://github.com/albitsj/clrn-az/tree/master)。本仓库保留 H5 测试及 APK Release 托管；Woodpecker 仍向 [CLRN Releases](https://github.com/kevinanew/clrn/releases) 上传 APK，上传完成后更新 clrn-az 的 `deployments/staging.json` 触发安卓回归。H5 部署继续更新本仓库同名 JSON。
