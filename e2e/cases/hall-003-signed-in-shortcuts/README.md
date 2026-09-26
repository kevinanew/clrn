# HALL-003：已登录大厅快捷功能

## 目的与前置条件

P1。默认 https://h5.page.shafayouxi.org/，简体中文，桌面 Chrome 与 iPhone 13 Chromium。
使用 `signedInAccount` fixture，每个测试使用独立浏览器上下文，通过用户名/密码登录已存在的 staging 测试账号，不注册账号。
搜索号码 `999999999` 在核查时不存在；不依赖账号余额、俱乐部数量或是否已签到。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 大厅搜索输入九位号码并按 Enter | 实际发出俱乐部搜索和私人房间查询，显示联合空结果，返回仍已登录 |
| 消息通知快捷入口 | 打开三类消息列表，点击大厅 Tab 可返回 |
| 商店快捷入口 | 真实钻石商品和价格加载，返回大厅 |
| 邀请朋友快捷入口 | 分享说明、下载及 H5 地址显示，返回大厅 |
| 每日奖励快捷入口 | 七天奖励列表、签到和救济说明可读，返回大厅 |

## 定位契约

使用当前可见且唯一的 `hall-search-button`、`club-search-input`、`club-search-back-button`、`notification-button`、`message-notification-item-<kind>`、`store-button`、`diamond-goods-list`、`product-price-0`、`invite-friend-button`、`come-and-play-text`、`download-url-text`、`url-text`、`share-button`、`daily-bonus-button`、`CheckInDateList`、`daily-bonus-check-in`、两类 `daily-bonus-*-instructions-body` 和返回按钮。

`CheckInDateListItem` 限定在唯一日期列表中，并检查七个有序日期及奖励。
联合搜索空结果目前没有 `data-testid`，用精确中文文案「没有找到相关俱乐部或个人房间」并检查唯一性；不使用截图替代业务断言。
搜索真实只读接口为 `GET /v10/club/search` 与 `PUT /v10/house/number/<number>`。

## 关联问题与限制

2026-09-26 已用 Playwright 复用现有新账号真实探索，并进行桌面及手机验证。

- 大厅搜索是俱乐部与私人房间联合查询，线上未提供二者切换 Tab；不虚构切换行为。
- 匹配区两个 `matching-title-switch-button` 点击后未观察到玩法或场次变化；未将点击无变化写成成功切换测试。实际匹配、入场和投注未执行。
- 每日奖励仅浏览，不签到或领取救济金；邀请页不向外发送消息，商城不购买。
- 本案例不覆盖老虎机、游戏内操作、实名/充值、俱乐部审批与管理、他人俱乐部申请或真实匹配。创建房间与俱乐部由独立案例覆盖。
- 搜索正常结果点击、已有房间加入等依赖确定业务数据，留给创建案例验证；搜索空态号码若将来被占用，需要维护前置数据。

账号由 `_shared/read-account-fixture.ts` 的 `signedInAccount` 提供，使用 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`（未设置时使用默认 staging 测试账号）。每例独立上下文并串行登录，阻断自动注册，不跨认证回归复用旧会话；读取真实钱包，无余额要求。

2026-09-26 已改用默认已有 staging 账号进行桌面与手机真实验证；运行时仍需满足上述空态/业务数据前置条件。

已有账号登录后若大厅被已观察到的 `<节点号> v10/club?user_id=… 网络有点问题，请重试` 提示阻挡，只读 fixture 使用最多执行一次的可见弹窗处理器，核对完整文案并点击“好的”（晚到的后台提示也适用，网络提示优先于隐私同意），同时记录 `staging-background-error` 注记；不处理其他错误或重复提示。
