# AUTH-005：找回密码入口表单

## 目的与前置条件

P1：邮件和短信两条找回密码路径的输入与返回导航。默认 https://h5.page.shafayouxi.org/，简体中文，桌面 Chrome 与 iPhone 13 Chromium，独立游客上下文，不需要账号或业务数据。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 用户名登录 → 找回密码 → 邮件/短信 → 填写联系方式 → 返回方式选择 → 返回用户名登录 | 对应输入可编辑，下一步可见，返回恢复选择页与原登录表单。 |

## 定位契约

forget-password-button、reset-password-by-email-button、reset-password-by-sms-button、email-address-input、phone-number-input、next-button、back-button。使用 data-testid 并断言当前可见目标唯一。缺少目标时失败，不跳过；无需业务接口写入。

## 关联问题

2026-09-26 已使用真实 Playwright 探索线上入口。不会点击下一步，覆盖范围止于验证码发送之前；邮箱使用 example.invalid。不注册、不发验证码、不改密、不提交登录凭据。
