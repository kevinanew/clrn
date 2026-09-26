# SETTINGS-003：商城钱包和礼品卡

## 目的与前置条件

P1；已部署 staging；简体中文、桌面和手机；已存在的 staging 测试账号。

## 步骤与预期

验证真实商品金额/价格；浏览注册奖励流水和购买记录；切换可用/过期礼品卡；打开兑换表单再返回。 每次返回后核对原入口或内容，可继续下一分支。

## 定位契约

diamond-goods-list、product-amount-0、product-price-0、coin-transaction-record-view、purchase-history-empty-text、available-gift-card、expired-gift-card、gift-card-input；单目标操作前断言可见唯一，业务内容使用文本/表单值断言。

## 关联问题

2026-09-26 已通过真实浏览器探索导航。真实账号有注册奖励流水，与视觉空态假设不同。要求无购买和礼品卡记录；不购买、不兑换。

账号由 `_shared/read-account-fixture.ts` 的 `signedInAccount` 提供，使用 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`（未设置时使用默认 staging 测试账号）。每例独立上下文并串行登录，阻断自动注册，不跨认证回归复用旧会话；读取真实钱包，无余额要求。

返回操作仅在遇到已观察到的 `v10/club?user_id=… 网络有点问题，请重试` 后台提示时，断言完整提示并由用户点击“好的”一次；报告写入 `staging-background-error` 注记。其他弹窗不处理，二次出现仍失败，不隐藏遮罩或强制点击。

2026-09-26 已改用默认已有 staging 账号进行桌面与手机真实验证；运行时仍需满足上述空态/业务数据前置条件。

已有账号登录后若大厅被已观察到的 `<节点号> v10/club?user_id=… 网络有点问题，请重试` 提示阻挡，只读 fixture 使用最多执行一次的可见弹窗处理器，核对完整文案并点击“好的”（晚到的后台提示也适用，网络提示优先于隐私同意），同时记录 `staging-background-error` 注记；不处理其他错误或重复提示。
