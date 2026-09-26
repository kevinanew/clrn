# AUTH-007：自动注册独立测试账号及钻石奖励

## 目的与前置条件

P0，默认 staging，简体中文，桌面和手机。无需预先配置账号。
使用 `_shared/account-fixture.ts` 的 `newAccount`：每轮运行最多注册一个账号，
生成随机用户名、16 位随机密码及设备 UUID，通过真实用户名登录/注册界面创建。
后续案例及手机项目恢复此账号的独立浏览器上下文，不重复登录或注册。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 从大厅打开用户名登录，提交本轮新凭据 | 实际发出注册 POST，HTTP 和业务响应均成功 |
| 注册后自动登录 | 登录请求成功、已登录大厅可见、账户接口为 200 |
| 读取本账号钻石钱包 | 返回有效且大于零的钻石余额 |
| 进入我的页面 | 页面钻石余额与钱包接口一致 |

首次注册可能显示隐私概要，测试核对正文后点击同意；若后台俱乐部列表出现
已确认的网络提示，核对精确接口及文案后点击“好的”一次并记录报告注记。
其他弹层或重复错误保持失败，不隐藏遮罩。

## 定位契约

`hall-sign-in-button`、`username-or-email-sign-in-button`、`username-input`、
`password-input`、`sign-in-button`、`hall-auth-state-signed-in`、`settings-tab`、
`diamond-balance-text`；通过共享 helper 检查当前可见节点唯一性。
注册请求为 `POST /public/v11/user/register/username_password`；
登录请求为 `POST /public/v10/user/login/username/password`；
钱包读取为 `PUT /v10/wallet/<user_id>`，请求 `currencies: ['diamond']`。

## 数据与安全边界

用户于 2026-09-26 明确授权自动注册 staging 测试账号，为创建功能提供钻石。
2026-09-26 实测注册赠送 50 钻，测试断言非零余额，不依赖固定赠送数量。
本案例不调用充值、划扣或 production 接口。密码不持久化；
会话在本轮专属 0700 临时目录内以 0600 文件保存，运行结束自动删除，
不写入仓库或报告；认证案例关闭 trace 和截图。
新账号保留在 staging 中，当前没有经过验证的测试账号删除接口；
创建类用例自行负责回收它们创建的业务对象，不冒用其他账号的数据。
现有固定账号登录 helper 仍禁止意外注册，自动注册必须显式使用 `newAccount` fixture。
同 IP 注册有频率限制；注册失败时本轮立即失败，不自动重试或回退到旧账号。
