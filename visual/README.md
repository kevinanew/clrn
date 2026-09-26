# 视觉回归测试（Web）

测试访问已部署的 `https://h5.page.shafayouxi.org/`，不检出应用源码、不构建 Web 包、不启动应用服务器。
用例与辅助代码使用 TypeScript；截图对比在 Docker/Linux 中运行以保持字体和渲染环境一致。
测试账号见 [应用仓库账号文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/testing/accounts.md)。

## 场景

| 页面 | 说明 | 登录态 | 固定填充 |
| --- | --- | --- | --- |
| 大厅（未登录） | `/`，等待 `[data-testid="hall-sign-in-button"]` | 未登录 | |
| 大厅牌局登录提示 | 未登录大厅点击德州游客场，等待登录确认弹窗 | 未登录 | 房间列表 |
| 私人局 tab（未登录） | 底部 `private-room-tab`（等待 `guest-private-room-empty-state`） | 未登录 | |
| 俱乐部 tab（未登录） | 底部 `club-tab`，校验游客登录引导与导航栏 | 未登录 | |
| 登录首页 | 点击大厅「登录」后截图 | 未登录 | |
| 用户名登录页 | 登录首页 →「用户名或邮箱登录」表单 | 未登录 | |
| 忘记密码页 | 用户名登录页 →「忘记密码」方式选择 | 未登录 | |
| 忘记密码-邮箱表单 | 方式选择 →「邮箱重置」表单首屏（不提交） | 未登录 | |
| 手机号登录表单 | 登录首页 →「登录/注册」手机号表单首屏（不发码） | 未登录 | |
| 忘记密码-短信表单 | 方式选择 →「短信重置」表单首屏（不发码） | 未登录 | |
| 选国家区号 | 手机号登录表单 → `country-code-selector` | 未登录 | |
| 用户协议 | 登录首页 → `user-agreement-button` | 未登录 | |
| 隐私政策 | 登录首页 → `user-privacy-button` | 未登录 | |
| 大厅（已登录） | 固定账号登录后的大厅 | 测试账号 | |
| 消息 tab | 底部 `message-tab` | 测试账号 | |
| 消息-俱乐部通知 | 消息 tab → `message-notification-item-club`（空态） | 测试账号 | |
| 消息-带入申请 | 消息 tab → `message-notification-item-buy-in`（空态） | 测试账号 | |
| 消息-系统通知 | 消息 tab → `message-notification-item-system`（空态） | 测试账号 | |
| 私人局 tab | 底部 `private-room-tab`（等 `copy-house-number-button`，确认房屋数据加载完成） | 测试账号 | |
| 俱乐部 tab | 底部 `club-tab`（club API mock 为空列表，默认落在「我的俱乐部」） | 测试账号 | |
| 俱乐部-牌局空态 | 俱乐部 tab → `club_tab_room`（空态） | 测试账号 | |
| 俱乐部-更多弹层 | 俱乐部 tab → `show-more-button`（不点选项） | 测试账号 | |
| 俱乐部-搜索 | 更多弹层 → `search-club-button`（空态，不输入） | 测试账号 | |
| 我的 tab | 底部 `settings-tab` | 测试账号 | 资产余额 |
| 加入房间弹窗 | 私人局 tab → `personal-house-join`（仅 UI，不加入） | 测试账号 | |
| 私人局详情 | 私人局 tab → `personal-house-create` | 测试账号 | |
| 选玩法弹层 | 私人局详情 → `create-game-button`（不选玩法、不创建） | 测试账号 | |
| 建房表单 | 选玩法 → 经典德州表单首屏（等选玩法弹层关闭后截，不点创建） | 测试账号 | 余额、房间名 |
| 建房表单-炸金花 | 选玩法 → 炸金花表单首屏（等选玩法弹层关闭后截，不点创建） | 测试账号 | 余额、房间名 |
| 建房表单-短牌 | 选玩法 → 短牌表单首屏（等选玩法弹层关闭后截，不点创建） | 测试账号 | 余额、房间名 |
| 大厅匹配区 | 登录大厅滚动至 `match-game-room-group`（不点开始匹配） | 测试账号 | |
| 个人资料 | 我的 tab → 头像区（`user-info-button`） | 测试账号 | |
| 编辑昵称 | 个人资料 → `profile-item-0`（仅表单首屏，不提交） | 测试账号 | 昵称输入框 |
| 编辑签名 | 个人资料 → `profile-item-3`（仅表单首屏，不提交） | 测试账号 | 签名输入框 |
| 账号安全 | 我的 tab → `account-security` | 测试账号 | |
| 账号安全-绑手机 | 账号安全 → `account-security-item-0`（无手机账号） | 测试账号 | |
| 账号安全-绑邮箱 | 账号安全 → `account-security-item-1`（无邮箱账号） | 测试账号 | |
| 账号安全-改密 | 账号安全 → `account-security-item-2`（已有密码） | 测试账号 | |
| 账号安全-注销首屏 | 账号安全 → `account-security-item-3`（不点下一步） | 测试账号 | |
| 等级 | 我的 tab → `user-level` | 测试账号 | |
| 商城 | 我的 tab → `mall` | 测试账号 | 金币/钻石余额 |
| 钱包流水 | 商城 → `currency-transaction-record-button`（金币 tab 空态） | 测试账号 | 余额 |
| 购买记录 | 我的 tab → `purchase-history`（空态） | 测试账号 | 列表头版本号 |
| 游戏记录 | 我的 tab → `game-record`（空态） | 测试账号 | |
| 礼品卡 | 我的 tab → `gift-card` | 测试账号 | |
| 礼品卡-兑换 | 礼品卡 → `exchange-gift-card-button`（表单首屏，不提交） | 测试账号 | |
| 礼品卡-已过期 | 礼品卡 → `expired-gift-card-tab`（空态） | 测试账号 | |
| 创建俱乐部 | 我的 tab → `create-club`（仅表单页，不提交） | 测试账号 | |
| FAQ | 我的 tab → `faq` | 测试账号 | |
| FAQ 详情 | FAQ → `faq-item-share_laiwan` | 测试账号 | |
| 联系我们 | 我的 tab → `contact-us` | 测试账号 | |
| 意见反馈 | 联系我们 → `feedback-button`（UserReport 已 mock 空白页） | 测试账号 | |
| 分享 | 我的 tab → `share-app` | 测试账号 | |
| 官网列表 | 我的 tab → `official-site` | 测试账号 | |
| 下载帮助 | 我的 tab → `download-help` | 测试账号 | |
| 下载帮助-苹果 | 下载帮助 → `apple-button` | 测试账号 | |
| 下载帮助-安卓 | 下载帮助 → `android-button` | 测试账号 | |
| 下载帮助-H5 | 下载帮助 → `h5-button` | 测试账号 | |
| 下载帮助-官网 | 下载帮助 → `official_website-button` | 测试账号 | |
| 关于来玩 | 我的 tab → `about-laiwan` | 测试账号 | 版本号、服务器编号 |
| 应用管理 | 我的 tab → `application-management` | 测试账号 | |
| 俱乐部通知 | 我的 tab → `club-notifications`（空态） | 测试账号 | |
| Telegram 频道 | 我的 tab → `telegram-channel` | 测试账号 | |
| 语言设置 | 应用管理 → `language` | 测试账号 | |

视口：**desktop (1440×900)** 与 **mobile (375×812)**。应用在 desktop 也是居中窄列布局，
**纯静态子页（消息二级页/个人资料/编辑昵称·签名/账号安全及其绑手机·绑邮箱·改密·注销首屏/等级/购买记录/
游戏记录/礼品卡及其兑换·已过期/钱包流水/创建俱乐部/FAQ/FAQ 详情/联系我们/意见反馈/分享/官网列表/
下载帮助及其子页/关于/应用管理/俱乐部通知/Telegram/语言设置/忘记密码及其邮箱·短信表单/
手机号登录/选区号/用户协议/隐私政策）只保留 mobile 视口**，
其余页面覆盖双视口（`scenarios.ts` 的 `viewports` 字段控制）。

- 全量（`VISUAL_LOCALES=all`）= (mobile 65 页 + desktop 23 页) × 3 语言 = **264 张**
- 默认仅简中 = **88 张**
- 核心范围（`VISUAL_SCOPE=core`）= 核心 13 页 × 2 视口 = **26 张**
  （大厅、未登录私人局、登录首页、用户名登录、未登录俱乐部、游客牌局登录提示、搜索登录提示、登录后大厅/消息/私人局/俱乐部/我的/商城）

### 易变内容固定填充（不用隐藏遮罩）

会随时间/发版变化的内容在截图前**替换为固定值**（内容仍可读，方便直接查看页面）：

- 用户资产余额（`[data-testid$="-balance-text"]`）→ `12345`
- 建房表单默认房间名（`[data-testid="room-name-input"]`）→ `TestRoom`
- 版本号（关于页、购买记录列表头）→ `0.0.0`
- 关于页服务器编号（测速选出的最快节点，每次运行可能不同）→ `0`
- 编辑昵称/签名输入框预填值（随测试账号资料变化）→ `TestNickname` / `TestBio`

在 `scenarios.ts` 对应页面的 `fixedTexts` 配置。仅「出现与否本身不定」的元素
（如关于页「有新版本」提示）才用 `hideSelectors`（display:none 摘除）。

暂不覆盖的页面及原因：

- 创建/加入房间、创建俱乐部的**提交**流程：会改动 staging 数据（建房表单仅截首屏）
- 忘记密码后续流程：需要真实邮箱/短信验证码
- 账号安全验证码输入、真正改密/注销提交：会改动 staging 账号（绑手机/邮箱/改密/注销仅截表单或提示首屏）
- 游戏对局、俱乐部详情/成员：依赖对局/俱乐部数据（测试账号为空；club API 已 mock 空列表）
- MatchTexasHoldem 独立匹配页：需浮动匹配态才能进入；大厅内嵌匹配区已覆盖
- 意见反馈第三方列表内容：UserReport 远端会变，已在 `pageSetup` mock 成空白页，只回归导航壳与标题栏

### 登录态如何实现（分片采集 + 逐场景注入）

- 每次运行开头及长轮次的分片边界由 `src/captureAuthState.ts`（`run-visual.ts`
  调起）按需重新登录：
  走真实 UI「大厅登录 → 用户名或邮箱登录」，然后把整份 localStorage
  存到 `visual/auth-state.json`（gitignore，语言键已剔除）
- 之后每个登录场景由 `src/support/pageSetup.ts` 直接注入该登录态，
  启动即已登录，**不再逐场景走 UI 登录**（每场景省 30-60s，并消除登录偶发失败）
- 注入失效（token 过期、staging 清零）时场景会明确失败，不在并行 worker 内
  回退 UI 登录，避免同一账号重复签发 token 后让其它场景的 token 失效
- 登录界面自带注册逻辑：用户名不存在时先调 staging API
  `/public/v11/user/register/username_password` 自动注册再登录，
  因此**每次运行都是同一个测试用户**（`VISUAL_TEST_USERNAME` /
  `VISUAL_TEST_PASSWORD`，可用 `VISUAL_USERNAME` / `VISUAL_PASSWORD` 覆盖；
  游客登录 `register/device` 在 Web 端不渲染，不可用）
- staging 数据清零后首次运行会自动重新注册；若用户昵称/ID 变化导致 diff，
  重新 `pnpm run reference` 即可
- 所有场景（含未登录）统一写入固定 `VISUAL_DEVICE_ID` 到
  `localStorage['deviceId']`：随机 deviceId 会让启动期设备注册回调在点击后
  触发导航重置，杀掉刚打开的登录 modal
- staging 在 Web 端稳定失败的俱乐部接口（`/v10/club?user_id=`、`/v10/clubs`）
  已 mock 成空列表，避免「网络有点问题」alert 在随机时刻弹出污染截图
- 代理元数据和健康检查固定选择
  `64.kr-seoul.api.staging.laiwan.shafayouxi.com`，避免测速把已断连节点误判为可用，
  导致业务 API 延迟报错或全局 Alert 污染后续截图
- 大厅可用版本接口（`/public/v1/hall_matching/available.json`）已固定为 `v3`；
  该接口失败会在 10 秒后弹「取消 / 重试」alert，即使已切换 tab 仍会污染截图
- 按 IP 取国家码接口（`/public/v10/profile/country`）已 mock 为固定 `86`（中国），
  并写入 `localStorage['app.user.country.code.key']`；否则 Docker/CI 出口 IP
  不同会导致手机号登录等页默认区号漂移（如本地日本 `+81`、CI 中国 `+86`）

## 从本机运行线上测试

只需要 Docker，无需下载或构建应用：

```bash
cd visual
pnpm run test          # 简中 88 张
pnpm run test:all      # 全部语言 264 张
pnpm run test:locales  # 繁中与英文
pnpm run reference    # 在 Linux 重建线上基准，需审核差异
pnpm run approve      # 审核失败截图后更新基准
pnpm run report       # 查看报告
```

Docker 只挂载测试仓库。`VISUAL_BASE_URL` 默认为线上地址，仅允许已部署的来玩 staging 域名。
`VISUAL_USERNAME` / `VISUAL_PASSWORD` 可覆盖已有测试账号，不要与其他正在运行的测试共用账号。
本机查看报告前执行 `pnpm install --frozen-lockfile`；`serve` 依赖仅供报告预览使用。

### 只跑部分场景

`VISUAL_FILTER` 会传给 `playwright test --grep`（正则匹配场景 label）：

场景 label 格式为 `{locale}_{viewport}_{page}`（如 `zh-Hans_desktop_hall`），
按「语言 → 视口 → 页面」生成。

```bash
cd visual && VISUAL_FILTER=signed_in pnpm run test           # 只跑登录后场景
cd visual && VISUAL_FILTER='zh-Hans_.*_hall$' pnpm run test  # 只跑简中大厅
cd visual && VISUAL_FILTER=zh-Hans_desktop pnpm run test     # 只跑简中桌面端
```

### 串行、分片与重试

- 每次运行固定一个 worker，桌面、手机和各语言顺序执行。
- 同一账号再次登录会作废旧凭据，即使 deviceId 相同也如此。功能、弱网、视觉 CI
  共用 `h5-staging-test-account` 并发组；本机测试也应避免与 CI 或人工登录重叠。
- test/reference/approve 均按语言分片，每批默认最多 3 个场景；简中全量为 30 批，
  核心为 9 批。分片之间重新采集登录态，场景只注入已有缓存，不自行回退登录。
- `VISUAL_TEST_SHARDS` / `VISUAL_REFERENCE_SHARDS` 可调整批数（1–80）；
  `VISUAL_REFERENCE_START_SHARD` 可从指定分片恢复 reference。
- 每批使用新的浏览器进程释放资源；无需重启任何应用服务器。
- 截图前校验图片已加载，缺图会明确失败。`VISUAL_RETRIES` 默认为 1。
- `reference-host.sh` 的锁阻止本机两轮 reference 同时运行；它不替代跨机器的账号协调。

## 语言过滤

环境变量 `VISUAL_LOCALES`：

| 值 | 用途 |
| --- | --- |
| `zh-Hans`（默认） | 日常线上（88 张）；push CI 再叠加 `VISUAL_SCOPE=core`（26 张） |
| `zh-Hant,en` | 仅非简中语言 |
| `all` | 全量 264 张（GitHub Actions 定时任务） |

环境变量 `VISUAL_SCOPE`：

| 值 | 用途 |
| --- | --- |
| `full`（默认） | 运行完整页面集合；未设置时也使用此范围 |
| `core` | 仅运行核心 13 页；简中双视口共 26 张 |

## CI

[视觉工作流](../.github/workflows/visual.yml) 在非 `release` 分支的视觉代码或工作流变更后，
访问线上并检查简中核心 26 张截图；每日及手动 `full` 运行三种语言的完整场景。
各语言顺序运行，不需要应用仓库 deploy key、Freshchat 构建配置或应用依赖。
结果反映运行时已部署版本，不代表测试仓库提交已部署到应用。

失败上传 HTML 报告与截图；关闭网络 trace，不上传 `auth-state.json`。
原来固定等待开局与翻牌圈的 12 张图片依赖应用专用 visual 构建，正常线上站点没有对应入口，
因此已从执行清单移除。历史图片保留，不计入当前 264 张有效场景。
不通过点击真实牌局来替代这些 fixture，避免改变线上游戏状态。

## 工作原理

1. Playwright 容器访问 `VISUAL_BASE_URL` 指定的已部署前端。
2. 登录态采集器通过真实 UI 登录，并用只读账户接口验证凭据。
3. 各场景注入语言、设备标识及已采集的登录态，再按实际导航进入目标页面。
4. `preparePage` 完成稳定化后与基准图比较，最多允许 0.3% 差异像素。

视觉测试仍保留现有的接口 mock 和固定文本填充，用于稳定余额、房间列表、国家码等截图内容；
它验证线上前端的视觉表现。真实认证行为由 `e2e/cases/auth-002*` 和 `auth-003*` 检查。
`tests/preparePage.spec.ts` 是测试工具自身的 DOM/HTTP fixture 检查，不启动应用开发环境。

### 测试与应用代码隔离

visual 专用的认证校验、mock、等待、重试、稳定化及截图判定逻辑必须保留在
`visual/`，不得为视觉测试向应用业务代码增加测试状态、测试组件或视觉测试专用分支。

## 排障

- 失败场景保留实际截图和差异图，使用 `pnpm run report` 查看 HTML 报告
- 引擎会把页面报错打进日志；就绪等待超时会输出 `DEBUG (...) >` 现场信息
  （可见文案、testid 列表等）
- 出现「分片登录态未生效」说明 staging 清零或 token 提前失效；重新运行即可，
  入口会重新采集登录态，场景自身不会并发登录并作废其它 worker 的 token
- `reference` 失败时**不要**直接提交生成的基准图，先看日志确认所有场景成功
- **页内点击导航必须走 `scenarios.ts` 的 `navClickTestIds`**（截图前执行）；
  不要改成截图流程末尾点击——打开的登录 modal 会被随即卸载，且极难排查

## 文件说明

| 路径 | 说明 |
| --- | --- |
| `scenarios.ts` | 场景单一数据源（页面清单、固定填充、登录后页面） |
| `tests/visual.spec.ts` | 由场景矩阵生成的参数化用例 |
| `playwright.config.ts` | Playwright 配置（阈值、串行执行） |
| `src/support/` | context 设置 / 页面准备 / 登录流程 |
| `src/captureAuthState.ts` | 运行开头的一次性登录态采集 |
| `run-visual.ts` | Docker/CI 入口（test / reference / approve） |
| `snapshots/` | 基准图（提交到 Git） |
