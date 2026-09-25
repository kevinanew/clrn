# 视觉回归测试（Web）

测试账号与登录方法记录在 [应用仓库的测试账号文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/testing/accounts.md)。

基于 **Playwright `toHaveScreenshot`**，对应用仓库带 `EXPO_PUBLIC_VISUAL_TEST_MODE=true` 的 `yarn build:web` 产物做整页截图对比。  
源码为 **TypeScript**；截图对比**必须在 Docker 中运行**，与 CI 一致。

## 场景

| 页面 | 说明 | 登录态 | 固定填充 |
| --- | --- | --- | --- |
| 大厅（未登录） | `/`，等待 `[data-testid="hall-sign-in-button"]` | 未登录 | |
| 大厅牌局登录提示 | 未登录大厅点击德州游客场，等待登录确认弹窗 | 未登录 | 房间列表 |
| 私人局 tab（未登录） | 底部 `private-room-tab`（等待 `guest-private-room-empty-state`） | 未登录 | |
| 俱乐部 tab（未登录） | 底部 `club-tab`，校验游客登录引导与导航栏 | 未登录 | |
| 德州经典桌-等待开局 | 固定 9 座（4 名玩家、5 个空座），无底牌/公共牌，底池 0 | 无 | 玩家昵称、头像、余额、盲注/D 标记与底池 |
| 德州经典桌-翻牌圈 | 固定 9 座（5 名玩家），展示底牌、翻牌、主/边池、玩家动作与操作区 | 无 | 玩家、牌面、底池、下注额与操作项 |
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

- 全量（`VISUAL_LOCALES=all`）= (mobile 67 页 + desktop 25 页) × 3 语言 = **276 张**
- 默认仅简中 = **92 张**
- 核心范围（`VISUAL_SCOPE=core`）= 核心 15 页 × 2 视口 = **30 张**
  （大厅、未登录私人局、登录首页、用户名登录、未登录俱乐部、德州等待开局、德州翻牌圈、登录后大厅/消息/私人局/俱乐部/我的/商城）

### 易变内容固定填充（不用隐藏遮罩）

会随时间/发版变化的内容在截图前**替换为固定值**（内容仍可读，方便直接查看页面）：

- 用户资产余额（`[data-testid$="-balance-text"]`）→ `12345`
- 建房表单默认房间名（`[data-testid="room-name-input"]`）→ `TestRoom`
- 版本号（关于页、购买记录列表头）→ `0.0.0`
- 关于页服务器编号（测速选出的最快节点，每次运行可能不同）→ `0`
- 经典德州等待开局桌：座位、昵称、SVG 头像、余额、D/SB/BB 标记及底池均由本地 fixture 固定；不连接房间、WebSocket 或用户资料接口
- 经典德州翻牌圈桌：玩家、底牌/公共牌、下注与动作、主/边池和操作项均由本地 fixture 固定；同样不连接房间、WebSocket 或用户资料接口
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

## 本地运行

应用源码默认放在本仓库的 `app/`（该目录已忽略）；也可设置 `VISUAL_APP_PATH` 指向已有的应用仓库。先在应用仓库安装依赖，并以 `EXPO_PUBLIC_PERF_TEST_MODE=false EXPO_PUBLIC_VISUAL_TEST_MODE=true yarn build:web` 生成 `build/`。构建时须配置应用要求的 Freshchat 环境变量；CI 使用占位值或仓库 Secrets。

```bash
git clone https://github.com/kevinanew/laiwan_react_native app
cd app && yarn install --frozen-lockfile
EXPO_PUBLIC_FRESHCHAT_TOKEN_FOR_WEB=visual-placeholder-token EXPO_PUBLIC_FRESHCHAT_WIDGET_UUID_FOR_WEB=visual-placeholder-uuid SIZE_MATTERS_BASE_WIDTH=350 SIZE_MATTERS_BASE_HEIGHT=680 EXPO_PUBLIC_PERF_TEST_MODE=false EXPO_PUBLIC_VISUAL_TEST_MODE=true yarn build:web
cd ../visual
pnpm run test          # 简中 92 张
pnpm run test:all      # 全部 276 张
pnpm run test:locales  # 繁中与英文
pnpm run reference     # 重建基准图
pnpm run approve       # 审核失败截图后才更新基准图
pnpm run report        # 查看报告
```

Docker Compose 会把应用目录挂到 `/repo/app`。使用现有的相邻仓库时，从 `visual/` 目录运行 `VISUAL_APP_PATH=../../laiwan_react_native pnpm run test`。`VISUAL_APP_PATH` 的相对路径以 `visual/docker-compose.yml` 为基准。测试依赖通过容器安装；本机运行 `pnpm run report` 需要在 `visual/` 执行一次 `pnpm install --frozen-lockfile`。

### 只跑部分场景

`VISUAL_FILTER` 会传给 `playwright test --grep`（正则匹配场景 label）：

场景 label 格式为 `{locale}_{viewport}_{page}`（如 `zh-Hans_desktop_hall`），
按「语言 → 视口 → 页面」生成。

```bash
cd visual && VISUAL_FILTER=signed_in pnpm run test           # 只跑登录后场景
cd visual && VISUAL_FILTER='zh-Hans_.*_hall$' pnpm run test  # 只跑简中大厅
cd visual && VISUAL_FILTER=zh-Hans_desktop pnpm run test     # 只跑简中桌面端
```

### 并行与重试

- `VISUAL_WORKERS`：并行 worker 数，日常对比默认 2；reference 固定为 1，避免多个
  禁用 GPU 的 Chromium 页面争抢软件栅格化资源，造成 page crash 与像素漂移
- test/reference/approve（包括 `VISUAL_FILTER` 与 `VISUAL_SCOPE=core`）都会按语言
  分成短 Playwright shard，默认每批最多 3 个场景（92 张全量为 31 批，30 张
  push 核心范围为 10 批；可分别用 `VISUAL_TEST_SHARDS` / `VISUAL_REFERENCE_SHARDS`
  调整为 1–80，approve 使用前者）。每批使用新的 worker/browser；只要本轮筛选
  包含登录场景，就在每个 shard 紧邻启动前重新采集登录态并重启静态服务器。
  reference 还会为 `zh-Hans` / `zh-Hant` / `en` 分别创建独立 Docker 容器。这样可及时回收
  Chromium，避免 2GiB 开发环境发生 OOM 和 `ERR_CONNECTION_REFUSED`
  级联失败。容器同时禁用 core dump，避免浏览器崩溃时在工作区留下数百 MB
  的 `visual/core`
- 诊断长轮次时可用 `VISUAL_REFERENCE_START_SHARD` 从指定分片续跑（默认 1，
  必须不大于 `VISUAL_REFERENCE_SHARDS`）；常规 `pnpm run reference` 始终全量运行
- 每个 shard 开始前会重启静态资源服务器，截图前也会校验同源图片均已真实
  加载；服务器退化时场景会明确失败，不会把缺图的半成品页面写进基准图
- `reference-host.sh` 使用进程锁禁止两轮 reference 并发争抢同一个 Docker
  虚拟机；上轮进程异常退出时会自动识别并清理失效锁
- `VISUAL_RETRIES`：失败自动重试次数，默认 1（吸收 staging 偶发波动）

## 语言过滤

环境变量 `VISUAL_LOCALES`：

| 值 | 用途 |
| --- | --- |
| `zh-Hans`（默认） | 日常本地（92 张）；push CI 再叠加 `VISUAL_SCOPE=core`（30 张） |
| `zh-Hant,en` | 仅非简中语言 |
| `all` | 全量 276 张（GitHub Actions 定时任务） |

环境变量 `VISUAL_SCOPE`：

| 值 | 用途 |
| --- | --- |
| `full`（默认） | 运行完整页面集合；未设置时也使用此范围 |
| `core` | 仅运行核心 15 页；简中双视口共 30 张 |

## CI

[GitHub Actions workflow](../.github/workflows/visual.yml) 在非 `release` 分支 push 时运行简中核心范围（30 张）；每天定时对简中、繁中、英文分别运行完整矩阵，也可手动选 `full`。各语言串行执行，避免同一账号的登录 token 相互失效。Action 从应用仓库 `master` 检出源码，构建 visual 模式 Web 包，然后在固定的 Playwright Linux 容器中运行本仓库的测试和基准图。

如果应用仓库是私有仓库，需要给本仓库配置能读取该仓库的 `APP_REPO_TOKEN` Secret。应用构建可选用 `EXPO_PUBLIC_FRESHCHAT_TOKEN_FOR_WEB` 和 `EXPO_PUBLIC_FRESHCHAT_WIDGET_UUID_FOR_WEB` Secrets；缺失时使用与原测试等效的占位值。失败时上传 HTML 报告与 trace。Action 检查的是运行当时应用仓库 `master` 的代码。

## 工作原理

1. 应用仓库构建 Web 产物，开启 `EXPO_PUBLIC_VISUAL_TEST_MODE=true` 以启用固定牌桌 fixture。
2. Docker/CI 的 `mcr.microsoft.com/playwright:v1.61.1-jammy` 托管应用 `build/`。
3. 每个短分片重新采集测试账号登录态，再按语言和场景写入 localStorage。
4. `preparePage` 完成导航、稳定化和固定文本填充后，`toHaveScreenshot` 与提交的 `snapshots/` 比对；允许最多 `0.3%` 差异像素。

### 测试与应用代码隔离

visual 专用的认证校验、mock、等待、重试、稳定化及截图判定逻辑必须保留在
`visual/`，不得为视觉测试向应用业务代码增加测试状态、测试组件或视觉测试专用分支。

> 本地不要在容器里跑 `yarn install`：部分 git 依赖在容器网络下会失败。CI 仍在 node 镜像里独立安装并构建。

## 排障

- 失败场景自动保留 **trace**（`test-results/`），`pnpm run report` 打开 HTML
  报告后可逐步回放（DOM/网络/截图时间线），比看日志高效得多
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
| `playwright.config.ts` | Playwright 配置（阈值、并行、trace） |
| `src/support/` | context 设置 / 页面准备 / 登录流程 |
| `src/captureAuthState.ts` | 运行开头的一次性登录态采集 |
| `run-visual.ts` | Docker/CI 入口（test / reference / approve） |
| `snapshots/` | 基准图（提交到 Git） |
