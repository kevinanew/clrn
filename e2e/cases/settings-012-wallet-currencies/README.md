# SETTINGS-012：钱包流水币种切换

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 从商城打开金币流水 | HTTP 和业务成功，响应及每条流水均为 coin，金币页展示对应流水 |
| 切换钻石 | HTTP 和业务成功，响应及每条流水均为 diamond，钻石页展示对应流水，金币页离屏 |
| 切回金币 | 金币页重新展示原金币流水，钻石页离屏；不修改资产 |

## 定位契约

`currency-transaction-record-button`、`coin-transaction-record-view`、`currency_transaction_top_tab_bar_diamond`、`currency_transaction_top_tab_bar_coin`、`account-security-items-list`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

只读接口：`/v11/wallet/<user_id>/currency/{coin,diamond}/statement`，按币种匹配真实响应。

两次响应均检查 `ok: true`、`result.currency_name` 及 `statements` 数组和条目结构；条目币种兼容真实简中接口的“金币／钻石”本地化名称，仍拒绝另一币种。非空时，在目标列表内核对首条流水的收支符号、金额、余额和浏览器本地时间，避免预先挂载的空容器或其他币种条目导致错误通过；首条抽样兼容长列表虚拟化。合法空数组要求目标列表没有流水条目，不强制造数据。

`cd e2e && npx playwright test test-wallet-statements.spec.ts` 单独验证断言的反向案例，包括错币种、业务失败、无效结构、错误展示、空数据及离屏列表，覆盖桌面／手机宽度并纳入既有 H5 E2E CI。这些固定响应和 DOM 的辅助测试不计作真实 staging 业务通过；本例仍只读取真实接口。

## 关联问题

SETTINGS-003 已覆盖金币注册奖励流水；本例补充钻石接口和页面往返。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
