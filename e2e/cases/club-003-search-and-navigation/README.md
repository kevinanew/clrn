# club-003：俱乐部列表与真实搜索

## 目的与前置条件

P1，已部署 staging，简体中文，桌面与手机，已存在的 staging 测试账号。不需要现有俱乐部或钻石，不创建俱乐部、不申请加入。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 打开俱乐部，切换牌局与我的俱乐部 | 对应列表页面可见 |
| 更多 → 搜索俱乐部 | 搜索页出现，菜单关闭 |
| 搜索完整随机 E2E UUID 名称 | 真实 GET /v10/club/search 携带完整 keyword，HTTP和业务成功，返回空数组 |
| 清空输入，返回列表和大厅 | 输入可清除，列表正常，大厅仍登录 |

## 定位契约

当前可见页面 `club-tab-screen`、`club_tab_room`、`club_tab_my_club`、`club-list-screen`、`show-more-button`、`club-more-popup`、`club-search-input`、`club-search-back-button` 唯一。菜单内单独定位 `search-club-button`，避免与保留的大厅入口重名。

## 关联问题

2026-09-26 真实搜索接口成功返回空数组。使用全新完整 UUID 查询避免依赖数据库中特定空编号。加入审批和现有俱乐部详情需专门业务数据，真实创建另由 club-001 / club-002 覆盖。

账号由 `_shared/read-account-fixture.ts` 的 `signedInAccount` 提供，使用 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`（未设置时使用默认 staging 测试账号）。每例独立上下文并串行登录，阻断自动注册，不跨认证回归复用旧会话；读取真实钱包，无余额要求。

2026-09-26 已改用默认已有 staging 账号进行桌面与手机真实验证；运行时仍需满足上述空态/业务数据前置条件。

已有账号登录后若大厅被已观察到的 `<节点号> v10/club?user_id=… 网络有点问题，请重试` 提示阻挡，只读 fixture 使用最多执行一次的可见弹窗处理器，核对完整文案并点击“好的”（晚到的后台提示也适用，网络提示优先于隐私同意），同时记录 `staging-background-error` 注记；不处理其他错误或重复提示。
