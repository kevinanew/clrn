# CLUB-004：房主连续移除俱乐部成员

## 目的与前置条件

P1，回归 Issue #6792。只在已部署 staging 执行桌面和手机项目，使用创建专用账号、`TESTING_API_TOKEN`、测试注册接口和测试余额接口。每例创建一个带 E2E 标识的俱乐部及两个独立成员账号；房主从 60 钻开始，创建俱乐部实际消耗 50 钻。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 房主创建本例俱乐部 | 创建响应有 UUID，钱包扣 50 钻，成员初始为 1 |
| 两个独立账号申请，房主审批 | 真实接口确认两人加入，服务端成员数为 3 |
| 房主在成员管理中移除成员 A | 确认真实 DELETE 成功，页面与服务端都剩 2 人 |
| 选中成员 B 后取消编辑 | B 仍在页面与服务端，人数保持 2 |
| 再次进入编辑模式并移除 B | 第二次 DELETE 成功，页面与服务端都只剩房主 1 人 |
| 用例中途失败 | 尝试移除本例的两个账号，并核对俱乐部只剩房主 |

## 定位契约

使用当前可见页面唯一的 `club-profile-item-touchable-member_management`、`club-member-normal-mode`、`club-member-edit-mode`、`club-member-item-<userId>`、`club-member-remove-selected-<userId>`、`club-member-cancel-button`、`club-member-remove-mode-button` 和确认弹窗。每次删除都校验页面人数、精确成员 ID 的 DELETE 响应，以及独立读取的服务端成员列表。准备成员时使用真实申请与审批接口，不使用 mock。

## 关联问题

本例标记 `@creates-data`，默认 `test:functional:existing` 不执行；显式运行 CLUB-004 或手动选择 `scope=all` 需要创建账号和测试接口凭据。当前没有已核实的俱乐部创建者删除入口，房主名下的 E2E 俱乐部和注册的测试账号会留在 staging。失败若发生在申请与审批之间，可能留下本例的待审申请；清理只针对已加入的成员。
