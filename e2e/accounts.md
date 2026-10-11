# 测试账号与权限

本页是测试账号的统一入口。以下账号只用于 **staging**（Web：<https://h5.shafayouxi.org/>）；不要用它操作 production 数据。

## 并行测试账号池

本机使用 30 个既有账号，CI 另有 30 个专用账号。全部 60 个用户名及获取方式登记在
[PRD 账号清单](https://github.com/kevinanew/laiwan_prd/blob/master/docs/测试与维护仓库.html#test-account-pool)。
本机凭据维护在 Git 共同元数据目录的 `clrn-test-accounts/accounts.json`，CI 凭据维护在
`CLRN_CI_TEST_ACCOUNTS` Actions Secret，恢复备份为同目录下的 `ci-accounts.json`；凭据文件权限为 0600。

本机功能、视觉、交互和 Freshchat 测试通过 `node ../scripts/with-test-account.mjs -- <测试命令>`
取得独占账号。CI 由各工作流分配账号并通过账号级并发组互斥，不同账号可以同时运行。
密码目前为独立的 16 位，H5 输入框上限为 20 位；密码变更后同步凭据文件，CI 还需更新 Secret。

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
