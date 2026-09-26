# HALL-001：游客私人房间导航

## 目的与前置条件

P1；线上 staging；桌面及手机；简体中文；独立游客上下文，无账号要求。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 打开入口并确认 staging 提示 | 大厅就绪且未登录 |
| 点击私人房间 | 显示游客空态 |
| 点击大厅 | 返回大厅且登录入口可见 |

## 定位契约

`confirm-button`、`hall-screen`、`hall-auth-state-signed-out`、`private-room-tab`、
`guest-private-room-empty-state`、`hall-tab`、`hall-sign-in-button` 均应唯一。

## 关联问题

无。测试不进入牌局，不创建房间。
