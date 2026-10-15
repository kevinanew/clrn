# 测试账号与权限

本页是测试账号的统一入口。以下账号只用于 **staging**（Web：<https://h5.shafayouxi.org/>）；不要用它操作 production 数据。

## 并行测试账号池

本机使用 30 个既有账号，CI 另有 100 个专用账号；完整 CI 用户名清单见 [`scripts/ci-test-accounts.json`](../scripts/ci-test-accounts.json)。原有账号及获取方式登记在
[PRD 账号清单](https://github.com/kevinanew/laiwan_prd/blob/master/docs/测试与维护仓库.html#test-account-pool)。
本机凭据维护在 Git 共同元数据目录的 `clrn-test-accounts/accounts.json`，CI 凭据维护在
`CLRN_CI_TEST_ACCOUNTS_V2` Actions Secret，恢复备份为同目录下的 `ci-accounts-v2.json`；凭据文件权限为 0600。

原有 30 个 CI 账号保留，新增 `clrnci261015001`–`clrnci261015070`；旧 Secret 保持原内容以兼容历史任务。

两组账号仅供 CLRN 使用，不与 `laiwan_react_native` 的独立测试或人工调试共用。
主应用部署后只触发 CLRN，由 CLRN 自己取得 CI 账号锁。其他项目需要登录时使用自己的账号。
CI 凭据注入检查仓库归属；本机启动器拒绝加载 CI 专用账号，避免本机锁绕过 GitHub 的账号锁。

本机功能、视觉、交互和 Freshchat 测试通过 `node ../scripts/with-test-account.mjs -- <测试命令>`
取得独占账号。CI 由各工作流分配账号并通过账号级并发组互斥，不同账号可以同时运行。
密码目前为独立的 16 位，H5 输入框上限为 20 位；密码变更后同步凭据文件，CI 还需更新 Secret。

## 测试开始前的金币准备

持续集成的 `configure-ci-account.mjs` 与本机 `with-test-account.mjs` 在取得账号独占锁后，
共用 `scripts/prepare-test-account.mjs` 为本任务账号设置 **10000 金币**，然后通过真实钱包接口回读核对。
准备在浏览器启动前完成，避免金币少于 1000 时自动出现救济金提示，干扰普通功能案例。
每次设置的是固定余额，不是累加充值；只修改当前任务的账号，不遍历其他正在使用的账号。

准备过程仅在 Node 中调用固定 staging 入口：普通用户名登录取得用户 ID，
`POST /public/v1/wallet/{用户ID}/set_balance/testing` 设置 `coin`，
再调用 `PUT /v10/wallet/{用户ID}` 核对余额。
测试令牌只发送给设置余额接口，不注入浏览器；客户端仍走正常初始化和界面登录。
缺少令牌、身份不符、接口失败或回读不符都会停止任务；本机准备失败仍释放账号锁。
持续集成使用 `TESTING_API_TOKEN` Secret，本机使用同名环境变量或相邻 staging 部署文件中的既有 Secret。

这一步只准备复用账号的金币，不改变创建场景现有的 60 钻石准备，也不改变临时注册账号的初始资产断言。
低余额或救济金专项案例应在通用准备之后显式设置自己的测试余额，并在完成后恢复 10000；
不要通过跳过初始化或屏蔽弹窗来验证这些业务。直接运行 Playwright 不会经过账号分配器，请使用上述共用入口。

金币核对后，同一账号锁内检查本人的私人房屋。旧测试中断留下的空房间会让建房按钮消失；
准备过程只恢复本人房屋中、本人创建、名称为 `TestRoom` 或 `E2E私局` 加时间戳的非官方房间，
且必须没有入座者、从未开始计时。删除前重新核对详情，删除后确认房间列表为空。
未知名称、归属不符、已开局、有人入座或接口失败均停止准备，不继续启动测试。
正常用例仍负责清理自己创建的准确房间 UUID，清理使用固定 staging 入口，不依赖客户端选中的地区代理。

## 兼容默认账号

| 用途 | 用户名 | 密码 | 已确认的权限与数据 | 使用位置 |
| --- | --- | --- | --- | --- |
| Web 视觉回归、弱网及 Freshchat 客服 E2E、人工登录检查 | `laiwanvisual01` | `visual2026test` | 2026-09-23 用 agent-browser 成功登录 staging；可进入 Club、Me，当前没有可用于成员管理的俱乐部数据 | `visual/` 与 `e2e/`（含交互及 Freshchat） |

线上视觉、弱网、功能、交互和 Freshchat 测试的账号默认值统一在本仓库维护。德州视觉回归使用 clrn 的真实页面回放，账号配置见 [clrn 视觉回归说明](https://github.com/kevinanew/clrn/blob/master/visual/README.md)。自动化测试可分别用 `VISUAL_USERNAME` / `VISUAL_PASSWORD` 和 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` 覆盖默认值。不要把登录 token、浏览器状态文件或新的私人账号密码提交到仓库。

## 用 agent-browser 登录

1. 打开 staging Web，关闭开发版本提示。
2. 点击大厅登录入口，选择「Sign in with Username/Email」。
3. 输入上表账号和密码，点击「Sign in/Sign up」。首次登录可能出现隐私提示和引导页。
4. 进入底部 Club / Me 页面检查目标功能。若页面显示 Retry，先确认俱乐部 API 是否可用，再进行依赖俱乐部数据的测试。

## 需要专用数据的场景

| 场景 | 所需账号和数据 | 当前状态 |
| --- | --- | --- |
| Issue #6792：连续删除俱乐部成员 | 一个俱乐部创建人和两个可删除成员 A、B；三者都要有 staging 账号，创建人账号中要有专用测试俱乐部 | 尚未准备。现有视觉回归账号的俱乐部数据为空；2026-09-23 在 Club 页出现 Retry，无法核实或创建成员数据 |

准备这类场景时，先用 agent-browser 在 staging 注册专用用户名账号，再由创建人建立专用俱乐部、让 A 和 B 加入。记录实际注册成功的账号、俱乐部名称、角色和日期到本页；测试中删除的是专用成员，结束后重新补齐成员。不要把未注册成功的账号列为可用账号。

## 维护

- 账号池凭据变更时，更新本机凭据文件及对应的 CI Secret，公开用户名统一维护在 PRD。
- 兼容默认账号变更时，同步修改本页、`visual/test-account.ts` 与 `e2e/helpers/environment.ts` 的默认值；新的私人凭据只保存获取方式。
- 俱乐部、资产、会员等可变数据应使用专用 staging 账号，避免影响视觉回归的固定账号。
- 每次使用专用账号前，先核对本页的权限和数据状态；失败时更新状态与最后核查日期。
