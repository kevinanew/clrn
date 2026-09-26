# AUTH-004：手机号及区号选择

## 目的与前置条件

P1：手机号登录表单的输入、国家区号回填及密码方式切换。默认 https://h5.page.shafayouxi.org/，简体中文，桌面 Chrome 与 iPhone 13 Chromium，独立游客上下文，不需要账号或业务数据。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 打开登录 → 手机号登录 → 选择中国香港 +852 → 填写非真实号码 → 切换密码登录 | 选区号后填写号码可回读，区号显示 +852，密码字段被遮蔽。 |

## 定位契约

phone-number-input、country-code-selector、pick-country-code-container、country-code-list-item-852、sms-request-code-button、password-sign-in-button、password-input（手机号密码页为容器，其内唯一 input 为密码框）。使用 data-testid 并断言当前可见目标唯一。缺少目标时失败，不跳过；无需业务接口写入。

## 关联问题

2026-09-26 已使用真实 Playwright 探索线上入口。初始国家区号异步加载，等待默认 +86 就绪后再操作。线上切换国家区号会清空已有号码，本案例先选区号再填写，不断言保留旧输入。区号列表有常用地区及字母分组，853 可能重复；使用当前可见且唯一的 852。不注册、不发验证码、不改密、不提交登录凭据。
