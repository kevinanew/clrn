# AUTH-006：协议与隐私正文

## 目的与前置条件

P1：两个法务入口的正文加载和返回导航。默认 https://h5.page.shafayouxi.org/，简体中文，桌面 Chrome 与 iPhone 13 Chromium，独立游客上下文，不需要账号或业务数据。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 登录首页 → 用户协议/用户隐私 → 验证 iframe 正文 → 返回 | 唯一 iframe 内有来玩与隐私正文，返回后登录方式与两入口可见。 |

## 定位契约

user-agreement-button、user-privacy-button、user-agreement-screen、user-privacy-screen、back-button；文档容器内唯一 iframe。使用 data-testid 并断言当前可见目标唯一。缺少目标时失败，不跳过；无需业务接口写入。

## 关联问题

2026-09-26 已使用真实 Playwright 探索线上入口。线上用户协议页面正文也包含隐私政策，记录现状但不把它判定为正确的法律文案；仅验证加载与返回。不注册、不发验证码、不改密、不提交登录凭据。
