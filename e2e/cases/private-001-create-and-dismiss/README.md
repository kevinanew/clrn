# private-001：私人德州牌局创建与解散

## 目的与前置条件

P0，已部署 staging，简体中文，桌面与手机。由环境提供的 staging 专用创建账号至少10钻；真实创建记分牌德州牌局，默认30分钟，不坐下或开始计时。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 进入私人房间，选择经典德州 | 显示9位房号、记分牌结算、10钻费用 |
| 填写唯一牌局名并提交 | 进入真实桌面，名称正确、私人房间、等待开始，扣10钻 |
| 菜单退出 | 私人房间仍显示唯一新建牌局 |
| 解散并确认 | DELETE /v1/room/{id} 成功，恢复创建入口，退回10钻 |

## 定位契约

当前可见页面内 `private-room-tab`、`create-game-button`、`game-type-button-texas_react_native`、`room-name-input`、`creat-room-button`（线上拼写）、`run-game-view`、`menu-button`、`drawer-menu-item-exit`、`close-room-button`、`private-room-confirm-popup`、`confirm-button` 唯一。牌局列表项使用真实 UUID 的 `private-room-{id}`。

## 关联问题

2026-09-26 真实探索确认：新账号赠50钻，私人牌局消耗10钻，未开始解散后完整退还。创建前监听真实 POST /v3/pay_action/do 并在页面断言前保存 result.room_id；finally 只清理本次 UUID。若创建响应后页面不可达，使用已验证 DELETE 接口兜底清理并保留原测试失败，不以跳过代替覆盖。多人带入、坐下、开局和实际牌局结算另需专门账号与测试数据。

若大厅后台俱乐部列表弹出已确认的网络错误提示，只允许用户点击“好的”一次并记录报告注释后继续；创建、解散、钱包请求仍必须真实成功。

创建后的多个后台俱乐部刷新请求可能依次产生网络提示。每次操作最多正常确认三条精确匹配的提示，并逐条记录报告注记；持续错误或其他提示仍失败，实际业务提交只点击一次。
