# AUTH-001：用户名登录表单

## 目的与前置条件

P1；线上 staging；桌面及手机；简体中文；游客，不提交登录请求。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 大厅点击登录、用户名或邮箱登录 | 用户名和密码输入框可见 |
| 填写示例文字 | 输入值正确，密码框的类型为 password |
| 查看找回密码入口 | 入口可见 |

## 定位契约

`hall-sign-in-button`、`username-or-email-sign-in-button`、`username-input`、
`password-input`、`forget-password-button` 均应唯一。

## 关联问题

无。示例文字不对应测试账号，不提交，因此不会触发自动注册。
