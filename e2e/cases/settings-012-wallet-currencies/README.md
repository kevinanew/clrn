# SETTINGS-012：钱包流水币种切换

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 从商城打开金币流水 | coin 流水真实 HTTP 成功，金币页进入视口 |
| 切换钻石 | diamond 流水真实 HTTP 成功，钻石页进入视口 |
| 切回金币 | 金币页重新进入视口；不修改资产 |

## 定位契约

`currency-transaction-record-button`、`coin-transaction-record-view`、`currency_transaction_top_tab_bar_diamond`、`currency_transaction_top_tab_bar_coin`、`account-security-items-list`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

只读接口：`/v11/wallet/<user_id>/currency/{coin,diamond}/statement`，按币种匹配真实响应。

## 关联问题

SETTINGS-003 已覆盖金币注册奖励流水；本例补充钻石接口和页面往返。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
