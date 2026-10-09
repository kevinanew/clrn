# H5 交互与 Freshchat E2E

滚动、触屏交互与 Freshchat 套件从应用仓库迁入本目录，复用现有账号与导航辅助代码。

测试账号、权限和登录方法统一记录在 [测试账号与权限](accounts.md)。
这是独立 npm 子项目，不构建应用；默认访问 staging，也可通过环境变量指定本地构建。

## 运行

```bash
cd e2e
npm ci
npx playwright install chromium # 本机首次安装或升级时执行
npm run test:interactions
npm run test:freshchat
npm run report
```

### 滚动与交互回归

`npm run test:interactions` 使用独立配置，分别运行桌面 Chromium 和启用移动设备、触摸能力的 Chromium。覆盖大厅上下滚动、我的设置列表后续条目导航、申请标签横滑与触底分页、建房弹层关闭及滑块拖拽、大厅和俱乐部故障后的重试恢复。

桌面发送鼠标滚轮与拖拽，触屏通过 Chromium 输入协议发送连续触摸事件；不改写 `scrollTop`，不使用强制点击、JS 点击或隐藏遮罩。断言包括滚动位置、可见内容、分页游标及请求次数、滑块数值和重试后的可操作性。此配置验证 H5，不代表原生 iOS/Android 或 Safari 已覆盖。

默认目标是 staging。验证当前修改时，先在项目根目录构建并启动本地 H5，再在本目录执行：

```bash
E2E_INTERACTION_BASE_URL=http://127.0.0.1:9087 npm run test:interactions
E2E_INTERACTION_BASE_URL=http://127.0.0.1:9087 npm run test:interactions -- --project touch
```

真实登录使用上述 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`，会话仅保存在内存中。串行运行以避免同一账号相互挤掉登录态；不要与使用同一账号的视觉测试同时运行。长列表及故障只在 HTTP 边界提供固定响应，其余仍访问 staging；不提交建房或审批操作。仅对 staging 或连接 staging 的本地构建运行此套件。

交互套件需显式运行。失败截图与 trace 位于 `test-results/interactions/`。

### Freshchat 在线客服

`npm run test:freshchat` 复用真实 staging 登录，在桌面和触屏 Chromium 中依次进入「我的 → 联系客服 → 在线客服」。保留真实 Freshchat 脚本、网络请求和跨域 iframe，检查 SDK 加载、入口打开聊天窗口、消息草稿输入与清空、点击窗口关闭按钮、再次通过入口打开，以及脚本和 iframe 没有重复创建。仅编辑草稿，不发送消息或创建客服工单；不覆盖消息送达、客服回复或原生 SDK。

账号通过 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` 覆盖，目标通过 `E2E_INTERACTION_BASE_URL` 覆盖，默认 staging。与其它使用同一账号的测试串行执行。登录浏览器上下文显式继承项目语言配置，避免 Linux 默认 `en-US@posix` 导致应用启动异常。页面导航复用最多三次尝试的有限重试，登录准备和客服场景分别有六分钟总预算，各阶段仍有独立超时（Freshchat 加载最多 60 秒）。失败截图和 trace 保存在 `test-results/freshchat/`；真实第三方服务持续不可用时测试必须失败，默认仅重试一次，可用 `E2E_RETRIES=0` 关闭重试。

客服用例已加入现有 `e2e/interactions/` 套件，执行 `npm run test:interactions` 会一起运行，也可通过 `npm run test:freshchat` 单独运行。它检查当前已部署 staging 的客服可用性；功能分支上的应用变更仍需先部署到 staging 或本地构建，再指定目标 URL 验证。

## 测试资产边界

需要调整测试账号资产时，只允许操作 staging：减少资产使用 `POST /v11/wallet/<user_id>/withdraw`，增加资产使用 `POST /service/v11/wallet/<user_id>/deposit`。`currency_name` 仅使用 `coin` 或 `diamond`，`amount` 为非负数，每次使用新的 UUID `transaction_id`。Production E2E 仅允许不会修改用户资产和业务数据的只读检查。

## CI

`.github/workflows/interactions.yml` 在本套件、公共辅助代码、依赖及工作流变更时运行，
也支持手动触发。先运行不含客服的交互场景，再单独运行 Freshchat，桌面与触屏串行执行。
与功能、弱网及应用视觉测试共用 `h5-staging-test-account` 并发组，并设置 `queue: max`。
目标读取仓库变量 `E2E_STAGING_URL`；Playwright 镜像与本目录锁文件均为 `1.59.1`。
失败上传 trace、截图与 HTML 报告。
部署说明见 [应用仓库 Web 文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/web/README.md)。
