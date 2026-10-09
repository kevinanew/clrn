# PRIVATE-004：私人房号输入限制

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 依次填空值、八位、九位数字 | 仅九位启用加入按钮 |
| 用真实按键清空后输入字母 | 输入仍为空，加入按钮禁用；不加入房间 |

## 定位契约

`private-room-tab`、`personal-room-smooth-pin-code-input`、`join-game-button`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

PRIVATE-003 已使用有效房号真实加入；本例补充无效输入及清空。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
