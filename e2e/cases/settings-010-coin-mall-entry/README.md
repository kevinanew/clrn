# SETTINGS-010：金币余额进入商城

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 进入我的并等待实际钱包响应 | HTTP 和业务成功，页面金币余额与响应一致 |
| 点击金币余额 | 商城收到 coin，商城余额与我的一致 |
| 观察初始分类 | 金币商品进入视口，钻石商品离开视口 |

## 定位契约

`coin-balance-text`、`coin-button`、`base-mall-screen-container`、`mall-coin-balance-text`、`diamond-goods-list`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

只读接口：`PUT /v10/wallet/<user_id>`，核对 HTTP、业务状态和 coin 余额。

## 关联问题

SETTINGS-003 从 mall 菜单进入钻石商品；本例检查金币余额入口及默认分类。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。

2026-10-07 和 2026-10-09 曾确认点击金币余额却默认展示礼品卡。应用 `src/mall/base/controller/BaseMallScreen.js` 开启 USDT 时的金币索引与实际标签顺序不一致。本例保留“默认显示金币”的预期，不将礼品卡作为正确结果。

此已确认产品故障用 `test.fail()` 标为预期失败，只放在最后一条默认金币分类断言之前。真实登录、钱包响应、余额、coin 路由参数，以及页面已加载金币或已知礼品卡错页均先按普通断言检查，其他故障不会被此标记吞掉。产品修复后金币断言通过，Playwright 报告 unexpected pass 并使运行失败，提醒移除此标记。预期失败不计为业务通过，不跳过执行、不点击分类按钮规避初始错页。
