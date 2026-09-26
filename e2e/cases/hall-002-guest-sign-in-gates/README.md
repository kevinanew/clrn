# HALL-002：游客功能登录门禁

## 目的与前置条件

P1：俱乐部、消息、我的、搜索和两种游戏入场的游客引导。默认 https://h5.page.shafayouxi.org/，简体中文，桌面 Chrome 与 iPhone 13 Chromium，独立游客上下文，不需要账号或业务数据。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 进入俱乐部/消息并点击空态；我的点击登录；搜索取消再确认；德州和拼三张游客场关闭登录提示 | 引导进入登录选项；取消或关闭后仍为游客大厅；入场提示要求登录。 |

## 定位契约

club-tab、message-tab、settings-tab、not-sign-in-container、after-sign-in-see-asset-text、hall-search-button、pop-up-message-text、cancel-button、confirm-button、close-button、game-matching-sign-in-popup、match-game-item-<game>-tourists。使用 data-testid 并断言当前可见目标唯一。缺少目标时失败，不跳过；无需业务接口写入。

## 关联问题

2026-09-26 已使用真实 Playwright 探索线上入口。大厅数据加载前游客场 ID 可能暂时重复，必须等待唯一性。未覆盖所有快捷入口的重复门禁（通知、商店、邀请、每日奖励、创建/加入房间、老虎机）。不注册、不发验证码、不改密、不提交登录凭据。
