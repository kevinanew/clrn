# club-001：真实创建俱乐部

## 目的与前置条件

P0，staging 简体中文、桌面与手机。由环境提供的 staging 专用创建账号至少50钻，真实创建名称带 E2E 标识的俱乐部。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 我的 → 创建俱乐部 | 名称和地区未填写时完成按钮禁用，费用50钻 |
| 仅填写名称，再填写地区 | 只有两个必填项完成后才能提交 |
| 点击完成 | 进入真实详情，名称/地区正确，成员1人，9位俱乐部ID，扣50钻 |
| 按创建响应的精确 UUID 独立读取详情 | GET /v10/club/{id}/profile 成功，名称、地区、owner_id、人数和页面俱乐部编号一致 |

## 定位契约

使用当前可见页面唯一的 `create-club`、`club-profile-list`、`edit-club-profile-input-name`、`edit-club-profile-input-region`、`edit-club-header-right-complete`、`club-home-page-screen`、`club-info-name`、`club-info-region-text`、`club-info-member-count`。POST /v3/pay_action/do 的创建响应提供真实 UUID；独立读取该 UUID 的 profile 验证持久化与账号归属。

## 关联问题

2026-09-26 真实创建已确认成功。详情、资料编辑、成员管理未发现解散俱乐部入口，本案例会在专用创建账号下保留明确 E2E 名称的俱乐部；不能把未验证的清理接口写入测试。多人审批、角色变更、星级升级需单独前置数据。

已确认缺陷：返回我的俱乐部时，后台 `v10/club?user_id=…` 请求可能报网络错误并使全量列表不显示新俱乐部；本案例验证创建与详情持久化，不将该列表缺陷计为通过。

创建后的多个后台俱乐部刷新请求可能依次产生网络提示。每次操作最多正常确认三条精确匹配的提示，并逐条记录报告注记；持续错误或其他提示仍失败，实际业务提交只点击一次。
