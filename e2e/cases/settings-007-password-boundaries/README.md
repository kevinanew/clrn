# SETTINGS-007：修改密码长度边界

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 旧密码有效，依次输入七、八、十六、十七位新密码 | 依次禁用、启用、启用、禁用 |
| 新密码有效，检查旧密码边界并清空 | 七/十七位及空值禁用，十六位启用 |
| 取消返回 | 回到账号安全列表；不提交修改密码 |

## 定位契约

`old-password-input`、`new-password-input`、`confirm-button`、`account-security-items-list`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

SETTINGS-002 已覆盖入口、空值及遮蔽，本例补充新旧密码各自的边界。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
