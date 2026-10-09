# CLUB-006：创建俱乐部表单反向校验

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 填有效名称和地区 | 完成按钮启用 |
| 地区改为纯空格，再恢复 | 先禁用，再启用 |
| 清空名称并返回 | 完成按钮禁用，回到我的页面；不提交创建 |

## 定位契约

`create-club`、`edit-club-header-right-complete`、`settings-screen`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

CLUB-001 已覆盖初始必填和真实创建，本例不创建数据。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
