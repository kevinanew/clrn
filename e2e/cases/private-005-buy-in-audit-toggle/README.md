# PRIVATE-005：三种玩法带入审核开关

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 分别选择德州、拼三张、短牌 | 建房表单出现，选择弹层关闭 |
| 点击审核开关两次 | 第一次为初始值的反值，第二次恢复初始值 |
| 取消返回 | 回到私人房入口；不创建牌局 |

## 定位契约

`private-room-tab`、`copy-house-number-button`、`game-type-button-*`、`base-create-room-screen`、`audit-buy-in-switch`、`create-game-button`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

PRIVATE-002 已检查名称、规则及高级设置；本例补充审核开关。每种玩法独立测试，共三项。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
