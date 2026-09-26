# club-002：俱乐部牌局真实创建与 API 清理

## 目的与前置条件

P0，staging 简体中文，桌面与手机。由环境提供的 staging 专用创建账号需要60钻，分别用于独立创建俱乐部50钻和记分牌德州牌局10钻。不得使用充值渠道或 production 资产。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 创建本用例独立 E2E 俱乐部 | 真实响应 UUID 与详情名称正确，扣50钻 |
| 俱乐部详情 → 创建牌局 → 德州 | 默认记分牌结算，费用10钻 |
| 填唯一牌局名并提交 | 真实 pay_action 响应的 building_type、building_id、creator_id、room_name 正确 |
| 查看真实牌桌 | 牌局名和俱乐部名匹配，等待开始，另扣10钻 |
| finally 通过 API 清理本次 UUID | DELETE /v1/room/{id} 成功，返还10钻 |

## 定位契约

当前可见页面唯一 `club-profile-item-touchable-create_game`、`game-type-button-texas_react_native`、`base-create-room-screen`、`creat-room-button`、`run-game-view`、`texas-holdem-room-name-text`、`texas-holdem-room-type-text`。创建前监听真实 POST /v3/pay_action/do 并在界面断言前保存 result.room_id，仅允许清理该精确 UUID。

## 关联问题

2026-09-26 真实探索已确认创建响应与牌桌归属字段。创建账号下的 E2E 俱乐部会保留，应用无俱乐部解散入口；牌局使用 finally 的精确 API 清理退款。不会坐下、开始计时或下注。

已确认 UI 限制：退出俱乐部牌桌会返回先前主 tab，并非俱乐部详情。实际切换 `club-tab` → `club_tab_room` 后，当前 staging 仍可能显示空态，同时全量俱乐部请求报网络错误，未显示刚创建的牌局。因此本案例不宣称覆盖牌局列表刷新或 UI 解散按钮；API 清理用于隔离测试数据，创建的真实响应与牌桌归属必须通过。

创建后的多个后台俱乐部刷新请求可能依次产生网络提示。每次操作最多正常确认三条精确匹配的提示，并逐条记录报告注记；持续错误或其他提示仍失败，实际业务提交只点击一次。
