# AUTH-007：测试接口创建独立账号并登录

## 目的与前置条件

P0，仅 staging，简体中文，桌面和手机。配置 `TESTING_API_TOKEN`，无需预先配置账号。
`newAccount` 每轮最多创建一个随机用户名、16 位密码和独立设备的账号。
Node 进程调用 `POST /public/v1/user/register/username_password/testing`，
以 `X-Testing-Api-Token` 请求头鉴权，仅传 username 和 password。
随后通过真实用户名登录界面登录；禁止回退到普通注册接口。
桌面和手机复用本轮会话，恢复时仅调用一次 `context.setStorageState`。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 测试接口创建账号 | HTTP 200、ok 为 true、返回有效 UUID 和相同用户名 |
| 从真实界面登录 | 登录账号与创建接口返回的 user_id 相同，账户接口为 200 |
| 读取钻石钱包 | 初始余额为 0，测试注册不发奖励 |
| 进入我的页面 | 用户名和钻石余额与接口一致 |
| 刷新并返回我的页面 | 保持同一账号和会话，余额不变，不调用普通注册接口 |

本案例不再验证普通注册奖励或奖励流水。俱乐部和牌局创建场景仍使用独立创建账号，
由测试余额接口准备 60 钻，不能依赖测试注册发奖。

## 定位契约

`username-input`、`password-input`、`sign-in-button`、`hall-auth-state-signed-in`、
`settings-tab`、`username-text`、`diamond-balance-text`。
登录接口为 `POST /public/v10/user/login/username/password`；
钱包读取为 `PUT /v10/wallet/<user_id>`，请求 `currencies: ['diamond']`。

## 数据与安全边界

专用 token 仅在 Node 进程中发送，不进入浏览器、trace 或报告，禁止 HTTP 重定向。
创建失败、重复用户名、缺失 token、未部署接口均明确失败，不重试、不退回旧注册流程。
密码仅保存在内存，会话位于本轮 0700 临时目录内的 0600 文件，结束后删除。
认证案例关闭 trace 和截图；新账号仍保留在 staging，临时会话清理不等于服务端账号删除。

## 运行

```sh
cd e2e
npm run test:functional:registration
```

GitHub Actions 手动选择 `scope=registration`，预检 `TESTING_API_TOKEN`；
不要求俱乐部创建账号凭据，也不创建俱乐部或牌局。自动 push 仍运行 existing 范围。
本案例验证测试账号准备和登录，不代表普通用户自动注册流程已被覆盖。
