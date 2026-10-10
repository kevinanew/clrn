# 视觉回归测试（Web）

测试访问已部署的 `https://h5.page.shafayouxi.org/`，不检出应用源码、不构建 Web 包、不启动应用服务器。
用例与辅助代码使用 TypeScript；截图对比在 Docker/Linux 中运行以保持字体和渲染环境一致。
测试账号见 [测试账号与权限](../e2e/accounts.md)。

德州与拼三张视觉用例及其登录态采集使用独立的 `mitmdump`，浏览器流量经过本机代理。
节点列表和节点健康检查由代理返回固定响应，业务数据的截图 fixture 保持原有规则。
App 登录态采集直连；我的战绩用例通过独立 mitmproxy 提供数据。德州代理脚本位于 `cases/texas-holdem/mitmproxy/`，
只复用 `../e2e/helpers/mitmproxy-*.ts` 的进程与控制客户端，完全独立于 E2E 故障脚本。
拼三张使用独立的 `cases/zhajinhua/mitmproxy/` 和 fixture，不加载德州代理脚本。
Docker 镜像安装 Python 3.12 与 mitmproxy 12.2.3；CI 的全部视觉任务也会安装。
已有镜像需先执行 `docker compose build visual`，再执行 `pnpm run test:texas`。
每例结束后停止代理并删除临时 CA，不保存网络 flow 或请求正文。

德州截图（包括 `zh-Hans_mobile_signed_in_texas_pre_game_chat`）中的 `0ms`
是 `fixedTexts` 固定文案，用于消除延迟变化造成的截图差异，不表示真实网速或代理延迟。
日志中的 `MITMPROXY > requests=..., stabilized=...` 用于确认真实流量经过代理。

## 场景

我的战绩已覆盖新旧版、桌面／手机和三种语言，使用独立的 mitmproxy fixture。
详细状态及应用限制见 [战绩覆盖清单](cases/game-record/COVERAGE.md)。

| 页面 | 说明 | 登录态 | 固定填充 |
| --- | --- | --- | --- |
| 游客消息／我的 | 消息登录引导、游客资产提示 | 未登录 | |
| 登录语言选择 | 登录首页 → 切换语言 | 未登录 | |
| 手机号密码登录 | 手机号表单 → 密码登录模式 | 未登录 | |
| 大厅联合搜索 | 大厅 → 搜索首屏 | 测试账号 | |
| 每日奖励 | 大厅 → 七日签到与救济说明，不领取 | 测试账号 | 签到规则与当前状态 |
| 免费抽奖面板 | 大厅 → 免费抽奖，不点击抽奖 | 测试账号 | |
| 三种玩法高级设置 | 经典德州／拼三张／短牌 → 展开高级设置 | 测试账号 | 余额、房间名 |
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
| 德州开局前牌桌 | 真实创建私人德州房 → 进入等待牌桌 → 截图桌面及菜单、牌型、主题、设置、带入、续费、排行、空牌谱、聊天、带入申请；另建开启升盲的房间截图等待牌桌及升盲详情 → 分别解散本次房间 | 测试账号 | 房号、房间名、昵称、钻石余额 |
| 拼三张牌桌 | 真实创建私人拼三张房 → 等待牌桌和常用面板 18 张；独立房间回放闷牌、看牌、快捷/精确加注、比牌选择、对手操作、摊牌、结算 8 张 → 解散本次房间 | 独立拼三张测试账号 | 房号、房间名、余额、延迟 |
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
其余页面覆盖双视口（对应 `cases/<功能>/scenarios.ts` 的 `viewports` 字段控制）。

主干新增德州状态的 198 张三语言基准与本次战绩的 372 张基准均纳入执行清单。

- 全量（`VISUAL_LOCALES=all`）= 每语言 342 张已有图 + 124 张战绩图，三语言共 **1398 张**（390 个场景）
- 默认仅简中 = **466 张**（130 个场景）
- 核心范围（`VISUAL_SCOPE=core`）= 280 张已有图 + 124 张战绩图 = **404 张**（68 个场景）
  （大厅、未登录私人局、登录首页、用户名登录、未登录俱乐部、游客牌局登录提示、搜索登录提示、登录后大厅/消息/私人局/俱乐部/我的/商城）

### 易变内容固定填充（不用隐藏遮罩）

会随时间/发版变化的内容在截图前**替换为固定值**（内容仍可读，方便直接查看页面）：

- 用户资产余额（`[data-testid$="-balance-text"]`）→ `12345`
- 建房表单默认房间名（`[data-testid="room-name-input"]`）→ `TestRoom`
- 版本号（关于页、购买记录列表头）→ `0.0.0`
- 关于页服务器编号（测速选出的最快节点，每次运行可能不同）→ `0`
- 编辑昵称/签名输入框预填值（随测试账号资料变化）→ `TestNickname` / `TestBio`

在对应 `cases/<功能>/scenarios.ts` 页面的 `fixedTexts` 配置。仅「出现与否本身不定」的元素
（如关于页「有新版本」提示）才用 `hideSelectors`（display:none 摘除）。

暂不覆盖的页面及原因：

- 第二账号加入房间及创建俱乐部的**提交**流程：会改动 staging 数据；德州建房场景会精确解散本次房间
- 忘记密码后续流程：需要真实邮箱/短信验证码
- 账号安全验证码输入、真正改密/注销提交：会改动 staging 账号（绑手机/邮箱/改密/注销仅截表单或提示首屏）
- 俱乐部详情/成员：依赖俱乐部数据（测试账号为空；club API 已 mock 空列表）
- 拼三张滑杆加注等无法通过 UI 到达的界面及本轮未覆盖范围见[拼三张覆盖清单](cases/zhajinhua/COVERAGE.md)
- 德州 RTC、猜牌记录等当前无法通过 UI 到达的源码界面，原因见[德州覆盖清单](cases/texas-holdem/COVERAGE.md)
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
pnpm run test          # 简中 466 张
pnpm run test:all      # 全部语言 1398 张
pnpm run test:locales  # 繁中与英文
pnpm run reference    # 在 Linux 重建线上基准，需审核差异
pnpm run approve      # 审核失败截图后更新基准
pnpm run report       # 查看报告
pnpm run lint         # 检查仓库代码文件不超过 400 行
```

Docker 只挂载测试仓库。`VISUAL_BASE_URL` 默认为线上地址，仅允许已部署的来玩 staging 域名。
`VISUAL_USERNAME` / `VISUAL_PASSWORD` 可覆盖已有测试账号，不要与其他正在运行的测试共用账号。
牌桌真实建房要求测试账号至少有 10 钻；不足时用 `TESTING_API_TOKEN` 将该 staging 测试账号设为 60 钻。
CI 从同名 Secret 注入，密钥不进入浏览器。截图后只解散本次创建响应返回的 UUID。
本机查看报告前执行 `pnpm install --frozen-lockfile`；`serve` 依赖仅供报告预览使用。

### 只跑部分场景

`VISUAL_FILTER` 用正则匹配场景 label，随后按选中的完整 label 精确筛选 Playwright 用例；
功能目录名不会影响匹配：

场景 label 格式为 `{locale}_{viewport}_{page}`（如 `zh-Hans_desktop_hall`），
按「语言 → 视口 → 页面」生成。

```bash
cd visual && VISUAL_FILTER=signed_in pnpm run test           # 只跑登录后场景
cd visual && VISUAL_FILTER='zh-Hans_.*_hall$' pnpm run test  # 只跑简中大厅
cd visual && VISUAL_FILTER=zh-Hans_desktop pnpm run test     # 只跑简中桌面端
```

### 串行、分片与重试

- 每个任务固定一个 worker，桌面和手机顺序执行；CI 各语言使用不同账号，可同时执行。
- 同账号同时创建相同配置的 `TestRoom` 会触发 staging 的重复牌局限制；
  本机并行任务应使用根目录账号池启动脚本，为各任务分配不同账号。
- 同一账号再次登录会作废旧凭据，即使 deviceId 相同也如此。CI 使用 30 个专用账号，
  套件／语言矩阵的九个任务各用一个账号；跨工作流以 `h5-staging-account-<用户名>` 互斥。
  不同账号可并行，选中同一账号的任务排队；本机账号池与 CI 账号池分开。
- test/reference/approve 均按语言分片，每批默认最多 3 个场景；拆分后每种语言的应用
  全量为 36 批、核心为 15 批，德州为 7 批、拼三张为 2 批。分片之间重新采集登录态，
  场景只注入已有缓存，不自行回退登录。
- `VISUAL_TEST_SHARDS` / `VISUAL_REFERENCE_SHARDS` 可调整批数（1–80）；
  `VISUAL_REFERENCE_START_SHARD` 可从指定分片恢复 reference。
- 每批使用新的浏览器进程释放资源；无需重启任何应用服务器。
- 截图前校验图片已加载，缺图会明确失败。`VISUAL_RETRIES` 默认为 1。
- `reference-host.sh` 的锁阻止本机两轮 reference 同时运行；它不替代跨机器的账号协调。

## 语言过滤

环境变量 `VISUAL_LOCALES`：

| 值 | 用途 |
| --- | --- |
| `zh-Hans`（默认） | 日常线上（466 张）；push CI 再叠加 `VISUAL_SCOPE=core`（404 张） |
| `zh-Hant,en` | 仅非简中语言 |
| `all` | 全量 1398 张（GitHub Actions 定时任务） |

环境变量 `VISUAL_SCOPE`：

| 值 | 用途 |
| --- | --- |
| `full`（默认） | 运行完整页面集合；未设置时也使用此范围 |
| `core` | 核心页面及本轮新增页面；简中共 404 张 |

## CI

[视觉工作流](../.github/workflows/visual.yml) 在非 `release` 分支的视觉代码或工作流变更后，
访问线上并检查简中核心 404 张截图；每日及手动 `full` 运行三种语言的完整场景。
CI 按「应用 app」「德州 texas」和「拼三张 zhajinhua」拆为独立任务并行执行；每套内部各语言仍顺序执行。
应用覆盖核心 164 张 / 全量 226 张，德州每种语言覆盖 188 张，拼三张覆盖 52 张，各任务分别保存失败报告。
不需要应用仓库 deploy key、Freshchat 构建配置或应用依赖。
手动触发可用 `suite` 选择 `all`、`app`、`texas` 或 `zhajinhua`，只重跑所需部分。
手动 `mode=reference` 在 Linux 中生成基准并上传 reference artifact，供下载和审查，
不会自动提交图片；`filter` 可只选新增场景。生成新图片时跳过依赖已有图片的完整性检查，
失败时的 reference artifact 可能不完整，需先修复并跑通；提交后 `mode=compare` 和 push CI
会执行完整检查和截图对比。
类型检查和场景配置测试只在简中应用任务运行一次（仅跑某个玩法时由其简中任务执行）；
浏览器辅助测试属于应用，只在简中应用任务运行；
本机运行 `test`、`reference` 或 `approve` 仍会执行浏览器辅助测试。
结果反映运行时已部署版本，不代表测试仓库提交已部署到应用。

失败上传 HTML 报告与截图；关闭网络 trace，不上传 `auth-state.json`。
原来固定等待开局与翻牌圈的 12 张图片依赖应用专用 visual 构建，正常线上站点没有对应入口，
因此已从执行清单移除。历史图片保留，不计入当前 1398 张有效截图。
德州通过 mitmproxy 回放固定牌局和弹窗数据，所有入口仍由实际 UI 点击打开。
覆盖清单、协议和当前源码限制见 [COVERAGE.md](cases/texas-holdem/COVERAGE.md)。
服务端房间保持等待状态，回放房间的操作 RPC 被代理隔离，每例精确解散本次真实创建的房间。

### 分别运行与账号隔离

```bash
cd visual
pnpm run test:app                 # 简中应用页面
pnpm run test:texas               # 简中真实德州牌桌
pnpm run test:zhajinhua           # 简中拼三张牌桌
VISUAL_SUITE=texas pnpm run test:all # 德州三种语言
```

`VISUAL_SUITE` 默认为 `all`，保留完整本机测试入口。按功能组划分用例，
应用的德州建房表单仍属 `app`，进入真实牌桌的用例分别属 `texas` 和 `zhajinhua`；
`VISUAL_SCOPE`、语言和 label 过滤可与它叠加使用。
`all` 会分别启动 App、德州、拼三张子进程，各自采集登录态；App 的登录采集也保持直连。

应用默认账号为 `laiwanvisual01`，单独的德州测试默认使用 `laiwanvisualtexas01`；
拼三张默认使用 `laiwanvisualzjh01`；三者沿用固定 staging 测试密码，随后通过 UI 登录复用账号。
账号应预先存在，登录态采集会阻断 UI 自动注册；缺失时明确失败。
确需新增账号时使用既有 E2E 的 `createTestingAccount` 和 `TESTING_API_TOKEN` 一次性注册，
在 PRD 登记后复用；管理 token 不发送给浏览器。
牌桌账号余额不足时允许为本轮使用的这三个固定账号或 GitHub Actions 专用池账号通过 `TESTING_API_TOKEN`
补钻，任意自定义账号不会自动补钻；新建房间仍在用例结束时解散。
CI 从 `CLRN_CI_TEST_ACCOUNTS` Secret 为每个任务注入 `VISUAL_USERNAME` / `VISUAL_PASSWORD`，
使用 30 个 CI 专用账号。旧 `VISUAL_TEXAS_*` / `VISUAL_ZHAJINHUA_*` CI 覆盖配置不再使用。
本机覆盖凭据仍用 `VISUAL_USERNAME` / `VISUAL_PASSWORD`。
账号页中的昵称、展示用户名和注册日期固定为既有视觉基准值，避免账号池轮转改变截图；
真实会话、认证缓存和受保护接口仍属于本轮分配的账号。

登录采集通过 `tsx` 运行，注入浏览器的脚本必须能独立序列化；
`src/support/pageSetup.test.ts` 在独立执行环境检查语言固定和禁动画脚本，
防止编译器的 `__name` 助手导致 Linux 的 `en-US@posix` 修正失效。
账户校验和钱包/入房请求失败仅记录首行原因，避免 Playwright Call log 把 Authorization 写进报告。

## 工作原理

1. Playwright 容器访问 `VISUAL_BASE_URL` 指定的已部署前端。
2. 登录态采集器通过真实 UI 登录，并用只读账户接口验证凭据。
3. 各场景注入语言、设备标识及已采集的登录态，再按实际导航进入目标页面。
4. `preparePage` 完成稳定化后与基准图比较，最多允许 0.3% 差异像素。

视觉测试仍保留现有的接口 mock 和固定文本填充，用于稳定余额、房间列表、国家码等截图内容；
它验证线上前端的视觉表现。真实认证行为由 `e2e/cases/auth-002*` 和 `auth-003*` 检查。
`tests/preparePage.spec.ts` 与 `tests/authValidation.spec.ts` 检查测试工具自身的 DOM/HTTP fixture，不启动应用开发环境。

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
- 强制中断真实建房用例后，保留 `test-results/**/created-room.json` 中的创建记录，
  先核实并解散本轮 UUID，再重跑；新一轮 Playwright 会清空结果目录。
  用例退出时优先直连解散房间，然后释放代理并关闭浏览器。
- 牌桌账号已有私人房时，页面不会出现 `create-game-button`，建房用例会失败。
  核实房间来源后清理，或通过 `VISUAL_USERNAME` / `VISUAL_PASSWORD` 使用空闲测试账号；
  用例只解散自身创建的 UUID，不自动删除账号中原有的房间。
- **页内点击导航必须走对应 `cases/<功能>/scenarios.ts` 的 `navClickTestIds`**（截图前执行）；
  不要改成截图流程末尾点击——打开的登录 modal 会被随即卸载，且极难排查

## 文件说明

| 路径 | 说明 |
| --- | --- |
| `scenarios.ts` | 语言、视口、范围过滤及场景矩阵 |
| `scenarioTypes.ts` | 场景类型与固定文本规则 |
| `cases/<功能>/scenarios.ts` | 对应功能的页面入口、导航和就绪条件 |
| `cases/<功能>/<功能>.spec.ts` | 对应功能的参数化用例 |
| `cases/<功能>/snapshots/` | 与用例放在一起的基准图（提交到 Git） |
| `cases/runScenario.ts` | 各功能共用的截图执行流程 |
| `playwright.config.ts` | Playwright 配置（阈值、串行执行） |
| `src/support/` | context 设置 / 页面准备 / 登录流程 |
| `cases/texas-holdem/proxy.ts`、`mitmproxy/` | 德州独立代理 fixture、HTTP 数据与 WebSocket 回放 |
| `cases/zhajinhua/proxy.ts`、`mitmproxy/` | 拼三张独立 HTTP 选址、资料夹具与 WebSocket 回放 |
| `src/captureAuthState.ts` | 运行开头的一次性登录态采集 |
| `run-visual.ts` | Docker/CI 入口（test / reference / approve） |
| `gallery/` | 截图浏览工具的 HTML 入口与清单（由 `pnpm run gallery` 生成） |
| `../lint-lines.mjs` | 仓库代码文件 400 行上限，CI 会执行 |

## 页面截图索引

完成 Linux `reference` 后，在本机运行：

```bash
cd visual
VISUAL_LOCALES=all npm run gallery
```

打开 [gallery/index.html](gallery/index.html) 即可使用，无需启动服务器。默认将同一页面的
语言和设备版本合并为一张卡片，优先预览简体中文手机图；卡片下方可切换其他版本。
页面名称显示为中文，原始场景名保留在搜索与截图详情中。顶部仅保留标题与统计，基准说明及清单链接收进「截图说明」，首屏优先展示截图。

- 按十一个功能模块浏览，数字为当前筛选匹配的页面数。
- 语言和设备可直接选择，分辨率、登录状态和图片大小收进「更多筛选」；搜索支持页面、文件名、入口及多个关键词，
  例如 `mobile chat`、`zh-Hans pre_game`，下划线和连字符均可识别。
- 「对比不同语言」将同一页面、同一分辨率的不同语言并排显示；「对比手机和电脑」将同一页面、
  同一语言的不同设备并排显示；「查看全部截图」展开所有匹配的版本，对照模式同样遵循筛选条件。
- 预览保持完整图片比例，可调整大小。所有匹配页面连续展示，不需要翻页；图片按需加载。
  语言、设备、浏览方式等筛选条件保存在 URL 中，刷新后恢复。
- 手机端模块栏可横向滑动，「筛选与对照」默认折叠，为截图保留更多空间。

列表中的每项功能也有快捷键，按 `?` 查看完整说明，控件旁显示对应按键：

- `/` 或 `Ctrl/⌘+K` 搜索；输入时照常打字，`Enter` 回到结果，`Esc` 返回图片。
- `G` 回到当前图片，方向键选图，`J`/`K` 选择下一张/上一张，`Home`/`End` 选择首张/末张，
  `PageUp`/`PageDown` 浏览一屏，`Enter` 或空格打开大图。
- `M` 进入模块选择，方向键移动、`Enter` 确认；`[`/`]` 直接切换模块，`Shift+M` 回到全部模块。
- `L` 语言、`V` 设备、`R` 分辨率、`A` 登录状态、`C` 浏览/对比方式、`S` 图片大小，
  加 `Shift` 反向切换。隐藏的筛选项会自动展开。
- `W` 切换当前图片版本（`Shift+W` 反向），`T` 展开/收起截图详情。
- `F` 展开/收起筛选，`E` 展开/收起更多筛选，`X` 清除所有筛选。
- `O` 打开选中图片原图、`D` 下载、`B` 展开/收起截图说明、`P` 打开页面清单。
- 所有控件也支持 `Tab`/`Shift+Tab`、`Enter`、空格及下拉框原生方向键操作。
  图片区域只保留当前图片及其控件进入 Tab 顺序，避免逐个经过数百张图片。
  关闭大图后，焦点与选中状态回到最后浏览的那张图片。

PNG 位于对应的 `cases/<功能>/snapshots/`，例如大厅截图与 `cases/hall/hall.spec.ts` 相邻。
点击截图会在页内打开大图，默认显示完整图片。「按宽度看」可从顶部阅读较长截图，滚轮上下移动，
Ctrl/⌘＋滚轮缩放；也可用按钮缩放、拖动图片，手机支持双指缩放。切图和切换版本保留显示方式与缩放倍数。
上一张/下一张和左右方向键可连续浏览当前浏览结果；大图中的语言和设备选择器可切换
同一页面的所有已收录版本（包括不在当前筛选条件内的版本），其他版本会在位置说明中标注。
每个操作旁直接显示快捷键：`←`/`→` 切图、`+`（或 `=`）/`-` 缩放、`0` 整图、`1` 原始大小、
`2` 按宽度、`↑`/`↓` 上下移动、`Shift+←`/`Shift+→` 左右移动、`PageUp`/`PageDown` 移动一屏、
`Home`/`End` 到图片顶部/底部、`L` 换语言、`V` 换设备（加 `Shift` 反向）、`O` 打开原图、`D` 下载、
`?` 查看/收起完整快捷键说明、`Esc` 关闭并恢复列表位置与焦点。双击切换适应窗口与原始大小。
快捷键在查看器打开期间有效，切换语言、设备或点击图片后仍可继续使用。
查看器也提供打开原图与下载入口。索引模板、列表样式与交互分别维护在 `snapshot-gallery-page.ts`、
`snapshot-gallery-styles.ts`、`snapshot-gallery-script.ts`，大图交互维护在 `snapshot-gallery-viewer.ts`，大图样式和控件维护在 `snapshot-gallery-viewer-ui.ts`。
[manifest.json](gallery/manifest.json) 记录当前场景的入口、就绪定位、固定内容、尺寸和
PNG 的 SHA-256。索引与测试共用 `buildScenarios()`，排除历史废弃图片；缺少基准图时命令失败，
不会将不完整覆盖报告为成功。生成索引不更新或批准图片，也不表示本次已重新测试历史基准。
默认索引为简中全量，可用 `VISUAL_LOCALES=all npm run gallery` 汇总三语言。

功能回归与截图采集共用默认账号，必须串行运行；功能测试用
`cd e2e && npm run test:functional:existing` 可排除所有注册和创建场景。

## 修改影响截图对比

[德州九人满桌、多底池对比](comparisons/pots-2026-10-10/README.md) 保存了 `Pots.js` 修改前后的真实牌桌截图、离线对比页和复现脚本。本批为 macOS 审阅图片，未更新正式 Linux 基准或持续集成截图矩阵。
