# SETTINGS-009：文字 FAQ 答案

## 目的与前置条件

优先级 P2。访问已部署的 staging，简体中文，桌面 Chrome 与手机 Chromium 各一份独立上下文。账号要求：已有测试账号。

使用 `_shared/read-account-fixture.ts` 的 `signedInAccount`，每例真实登录已有账号，不自动注册、不保存登录 trace。

## 步骤与预期

| 操作 | 预期 |
| --- | --- |
| 打开 plug_in 问题 | 详情标题与所选问题一致，正文段落非空 |
| 返回问题列表 | 原问题仍显示且文本不变 |

## 定位契约

`faq`、`faq-item-question-plug_in`、`faq-detail-scroll-view`、`faq-detail-paragraph-*`、`faq-screen`。唯一目标检查当前可见页面内的数量；分页内容额外使用 `toBeInViewport()` 区分离屏页。

## 关联问题

SETTINGS-004 检查 share_laiwan 图片答案；本例补充 plug_in 文字答案。

从应用仓库 2026-10-07 的 agent-browser 探索及 2026-10-09 的去重结果迁入。测试不导入应用源码，不替换业务接口。迁入后的执行结果见 [覆盖盘点](../COVERAGE.md)。
