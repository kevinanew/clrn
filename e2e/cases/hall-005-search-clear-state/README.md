# HALL-005：清空搜索恢复默认引导

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 输入本轮唯一关键字并搜索 | 真实 HTTP 和业务成功，显示结果空态 |
| 清空关键字 | 结果空态消失，默认搜索引导重新显示 |

## 定位契约

`hall-search-button`、`club-search-input`、`club-search-default-empty`、`club-search-results-empty`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

只读接口：`/v10/club/search?keyword=<本轮关键字>`，仅等待匹配当前关键字的真实响应。

## 关联问题

HALL-003 / CLUB-003 已覆盖真实空结果和清空输入，本例补充清空后的页面状态。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
