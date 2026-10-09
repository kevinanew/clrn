# MESSAGE-002：带入通知处理状态切换

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 打开带入通知 | 未处理标签选中 |
| 切到已处理 | 已处理选中，未处理未选中 |
| 切回未处理并返回 | 两个标签状态互斥，回到消息分类列表 |

## 定位契约

`message-tab`、`message-notification-item-buy-in`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

MESSAGE-001 已打开带入通知并检查空态，本例补充标签选中状态。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
