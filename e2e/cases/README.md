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
npm run test:functional:existing
npm run test:functional:joining
npm run test:functional -- club-004-member-management # 多账号连续移除，需创建凭据
```

默认站点为 https://h5.page.shafayouxi.org/，可用 `E2E_STAGING_URL` 指定已部署的 staging。
桌面与手机使用独立浏览器上下文，统一串行执行，不共享浏览器登录状态。

`test:functional:existing` 明确排除标记为 `@creates-data` 的 AUTH-007、CLUB-001、
CLUB-002、CLUB-004、CLUB-005、PRIVATE-001、PRIVATE-003，适用于已有账号浏览、认证和表单回归，不需要创建专用账号或
TESTING_API_TOKEN。被排除流程不计为通过。默认 `test:functional` 仍执行全部案例。
`test:functional:joining` 只运行私人房加入和俱乐部申请、审批及邀请入会，需配置创建专用账号和 TESTING_API_TOKEN。
功能 CI 的 push 和默认手动运行也使用 existing；具备专用账号后手动选择 `scope=all`
才运行创建流程及其凭据预检。

不要同时运行功能登录测试和视觉截图：默认使用同一已有账号，新登录会使另一轮凭据失效。

## 新增案例

1. 创建 `<功能>-<三位编号>-<场景>/`，编号不重复使用。
2. 用中文说明目的、前置条件、步骤与预期、定位契约和关联问题。
3. 在 `test.spec.ts` 中按准备、操作、断言编写 `test.step()`。
   会创建账号、俱乐部或牌局的案例必须标记 `{ tag: '@creates-data' }`，保持 existing 范围不创建数据。
4. 使用 `getByTestId()`，当前可见页面内的唯一目标先断言数量；缺少定位时明确失败。
5. 仅在真实重复时把共用准备流程提取到 `_shared/`，业务断言留在案例内。
6. 普通登录场景使用已存在的 staging 测试账号，禁止因账号缺失意外注册。
   用户已授权的自动注册和创建类案例仅在 staging 使用独立账号，参见
   [AUTH-007](auth-007-auto-registration/README.md)。新建业务对象必须说明结果验证和回收方式。
   不进行真实充值、改密或操作其他用户的数据。

## 报告

HTML 报告位于 `e2e/playwright-report/cases/`；失败截图位于 `e2e/test-results/cases/`。
报告和登录状态不提交 Git；功能测试关闭网络 trace，避免保存登录凭据。
CI 从 30 个专用账号中分配每轮账号，按用户名设置 job 并发组；不同账号的任务可同时运行，同账号任务排队。

## 案例说明模板

```markdown
# 功能-编号：用户场景

## 目的与前置条件

优先级、线上入口、视口、语言、账号要求、所需数据。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 用户动作 | 可验证结果 |

## 定位契约

列出当前可见页面内的 data-testid、唯一性，以及需要验证的只读接口。

## 关联问题

记录确认过的线上行为、核查日期及已知限制，不能把推测写成既定契约。
```

先用 `agent-browser` 或 Playwright 探索已部署页面，再写稳定的断言。
源码仅用于理解流程和定位契约，测试不导入应用源码。
认证案例使用不同上下文和明确的设备标识，并在内存中保存旧凭据，避免应用清理缓存后无法验证旧会话。

### 仅验证注册

`npm run test:functional:registration` 或手动 CI 的 `scope=registration`
只运行 AUTH-007 桌面／手机项目，每轮最多创建一个账号。
它通过专用测试接口创建账号，需要 TESTING_API_TOKEN，检查真实界面登录、账号身份、
零初始钻石和刷新后的会话与余额；不检查普通注册奖励，不运行俱乐部或牌局创建。
测试接口失败不会回退到普通注册或重试；自动 push 仍运行 existing。

## 应用仓库迁入的补充回归

2026-10-09 迁入去重后的 14 个业务场景，分布在 AUTH-011、SETTINGS-007～012、
CLUB-006、HALL-005、MESSAGE-002、PRIVATE-004～005，桌面和手机共 28 项。
所有新增场景均不创建数据，已纳入 `test:functional:existing` 与既有功能 CI；
具体增量与验证结果见 [COVERAGE.md](COVERAGE.md)。

SETTINGS-010 的金币入口仍有已确认的产品错页，仅最后一条默认金币断言标为预期失败。
测试仍执行真实登录、钱包和页面检查，不能将预期失败记为业务通过；产品修复后运行会
因 unexpected pass 失败，需移除该标记。其余场景没有跳过或预期失败标记。
