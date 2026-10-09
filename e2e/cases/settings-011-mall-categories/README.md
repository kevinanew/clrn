# SETTINGS-011：金币与钻石商品切换

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 选择金币 | 金币商品进入视口，钻石列表离开视口 |
| 选择钻石 | 真实钻石价格进入视口，金币页离开视口 |
| 再选金币 | 金币页重新进入视口；不购买 |

## 定位契约

`mall`、`mall-tab-bar-Coin`、`mall-tab-bar-Diamond`、`diamond-goods-list`、`product-price-*`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

SETTINGS-003 / HALL-003 已检查钻石商品；本例补充金币及往返切换。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
