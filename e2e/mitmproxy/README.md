# Python 网络夹具

集成、静态视觉和动画场景只通过 TypeScript 控制客户端选择场景、操作 UI 并断言。
响应体、错误注入和 WebSocket 消息由 Python 生成，不回调 Node/TypeScript。
默认 `none`，未命中的业务请求和 CORS 预检透传。控制接口只接受本轮随机 token，
不接受响应载荷；普通浏览器不持有控制 token。私有诊断来源仅以 `laiwan_prd` 标识，
不得在夹具或日志中复制私有连接资料。本次迁移未读取该资料。

每例独占 `mitmdump`、回环端口和临时 CA；保留账号锁和创建房间后的精确清理。
`helpers/mitmproxy-process.ts` 先加载共用 `scenario_fixtures.py`，再加载所选专用 addon。
已返回的共用响应不会被专用 addon 覆盖；暂缓响应也先经过共用 gate。
`helpers/scenario-proxy.ts` 只关联实际使用该代理的 BrowserContext，缺失关联立即失败。
E2E 和视觉 fixture 分别使用各自子项目的 Playwright 版本，复用进程与控制代码。

## 接口盘点与去留

以下路径均相对 API；`user`、`room`、`house` 表示本轮实体，不是固定生产标识。
旧 TS 位置相对 `visual/`，交互位置相对 `e2e/`。固定数据位于本目录 `data/`；
玩法专用的 Python 数据仍留在原目录，避免引入通用配置语言或响应桥接服务。

| 原实现／接口 | 目的与场景 | 决定与当前实现 |
| --- | --- | --- |
| `src/support/networkMocks.ts`：国家码 `GET /public/v10/profile/country` | 手机号表单区号一致 | 保留为视觉环境，`scenario_fixtures.py` + `country.json`；应用自行缓存区号 |
| 同上：Freshchat 资源断连 | 非客服视觉场景不加载聊天 SDK | 保留为显式视觉环境；真实 Freshchat 交互不启用 |
| 同上：UserReport 页面 | 仅截反馈导航外壳 | 保留为显式视觉环境的 HTML 空页 |
| 同上：`/v2/room/disallow-rule/reminder` | 隐藏真实维护错误 | 删除覆盖，真实透传；不再把 401 改成成功 |
| 同上：`/public/v1/hall_matching/available.json` | 固定可用大厅版本 | 删除正常流程覆盖，真实透传；仅故障用例断连 |
| 同上：`/public/v1/hall_matching/{texas_holdem,zhajinhua}/halls` | 固定大厅列表 | 删除覆盖及两份无调用的 `visual/fixtures/hall-matching-*.json`，使用真实列表 |
| 同上：`GET /v10/club?user_id=…` | 俱乐部空态 | 仅 `club-empty` 场景匹配已绑定账号的单一 `user_id`；其他视觉场景透传或交给专用虚拟俱乐部 addon |
| 同上：`PUT /v10/clubs` 返回空数组 | 隐藏俱乐部详情 | 删除全局覆盖；只有确切虚拟 ID 批次才在对应 addon 返回详情 |
| 同上：`GET /v10/house/user/user`、访问历史、`/v2/building/rooms` 空数组 | 固定私人房归属与房间列表 | 删除全局覆盖；真实房号、归属、历史及列表透传 |
| 同上：`GET /v*/alipay_order/goods` | 商城商品卡片 | 仅 `mall`，`goods.json`；不产生订单，不点击真实购买 |
| 同上：`GET /v11/wallet/user/currency/{coin,diamond}/statement` | 钱包流水空态 | 仅 `wallet-empty`，绑定本轮 user；钱包余额仍真实 |
| 同上：`GET /v2/check_in/seven_day/{rule,current}` | 每日奖励已签到展示，不领取 | 仅 `daily-bonus`，规则数据文件和当天签到时间；保留日期文字稳定化 |
| 同上：`/v10/club/application`、`/v10/buy_in/auditor/user/applications/pending` 空数组 | 全局压制通知状态 | 删除全局覆盖；仅分页用例需要时控制申请列表 |
| `cases/hall/walletPresentation.ts`：`PUT /v10/wallet/user` | 每日奖励救济金按钮固定展示 | 迁入 `daily-bonus` response hook；先获取真实成功钱包，仅改本人 coin 展示为 1000，保留钻石、身份、未知字段及失败响应，不修改服务端资产 |
| `animations/applicationFixtures.ts`：`PUT /v2/building/rooms` | 邀请面板需要等待中的房间 | `invitation` + `invitation.json`；从真实成功的 `PUT /v10/house/user/user` 响应确认归属，兼容 GET；只处理该 house 的确切批次，不连接虚拟牌局或发送邀请 |
| `animations/matchingFixtures.ts`：`POST /v1/hall_matching/{join,quit,keep_waiting}` | 匹配旋转弹窗，不进入真实队列 | `matching`；HTTP 和 Centrifuge method 9 RPC 都隔离，订阅与心跳透传 |
| `animations/slotFixtures.ts`：`/v2/slot_machine/user/user/{energy,spin}` | 三类奖励、能量不足动画 | `slot`；HTTP 与 WebSocket 同一 Python 实现；spin 未绑定或账号不符返回错误，绝不发送真实抽奖 |
| 同上：完整伪造 `PUT /v10/wallet/user` | 固定老虎机工具栏余额 | 删除覆盖，使用真实钱包；动画断言从真实响应读取金币/钻石，不降低数字控件断言 |
| `animations/skeleton.spec.ts`：俱乐部列表和详情 | 两条骨架脉冲动画 | `club-skeleton`；列表仅匹配已绑定账号的单一 `user_id`，详情仅匹配确切虚拟批次，`hold/release` 控制等待 |
| `cases/launch/launch.spec.ts`：`GET /node/v1/status` 暂缓 | 截启动加载页 | 仅 `launch` 暂缓，释放后继续真实健康探测；正常场景不延迟、不伪造健康 |
| `animations/texasFeedback.ts`：`PUT /v10/texas_holdem/room/room/user_settings/{enable,disable}_auto_rebuy` | 加载旋转图标 | `auto-rebuy`；必须先观测本账号成功建房响应；释放等待后仍隔离写入，其他房间透传 |
| `interactions/fixtures.ts`：大厅版本、维护提醒 | 全局稳定化 | 删除覆盖，保留真实 worker 登录和正常初始化 |
| `interactions/pagination.spec.ts`：`GET /v10/buy_in/auditor/user/applications/{pending,processed}` | 横滑、触底分页、末页停止 | `pagination`；绑定当前会话 user，12+3 条、唯一下一页游标，错误游标明确失败；不审批 |
| `interactions/scroll-and-controls.spec.ts`：俱乐部列表／大厅版本失败 | 重试恢复 UI | `club-error`、`hall-error`；释放后读取真实成功响应，核对请求重新发出 |
| `cases/{texas-holdem,zhajinhua}/replayData.ts` 及其所有调用中的事件对象 | 固定牌局、公共牌、看牌、下注、摊牌、结算、倒计时、语音／表情／道具 | `replay_scenes.py` + `{texas,zhajinhua}-{table,replay}.json`；TS 仅传具名场景及受限枚举，不发送任意消息 |

已有 Python 专用夹具逐项保留，原因和范围如下；它们均只在选定场景启用：

| 位置／接口 | 场景、保留原因与隔离 |
| --- | --- |
| `network_faults.py`：大厅版本、登录密码、俱乐部列表断连及登录用户名存在检查 | 弱网错误恢复；仅登录失败场景固定“已存在”以避免注册，其他登录保持真实 |
| 同上：`GET /v10/club/search?keyword=…`、`PUT /v10/clubs` | 精确 GET 关键词与 PUT 虚拟俱乐部 ID 批次的只读命中卡片；功能和视觉共用，其他关键词、方法及预检透传 |
| `visual/cases/club/mitmproxy/addon.py`：`GET /v10/club`、`PUT /v10/clubs`、`PUT /v2/building/rooms` | 有数据俱乐部列表；资料与房间批次仅限虚拟俱乐部，保留专用场景计数 |
| `visual/cases/game-record/mitmproxy/{addon,data}.py`：`/v10/texas_holdem/user/user/game_records`、`/v11/game_log/user/play_session_record/recent` | 战绩新旧版、空／列表／分页／列表错误；仅本轮 user 与虚拟记录 |
| 同上：`PUT /v1/room`、`/v{1,11}/game_log/room/settlement`、`/v1/game_log/user/user/rooms/settlement` | 固定虚拟房名与汇总 |
| 同上：`/v1/game_log/room/room/{game_amount,game,settlement}`、`/v1/game_log/room/game_amount`、`/v1/game_log/user/user/games` | 虚拟战绩详情、牌谱及错误分支；删除只作用于虚拟记录，保留删除错误断言 |
| 同上：俱乐部、玩家资料批次及 `GET /public/v11/game_log/available.json` | 虚拟记录关联资料；版本仅覆盖真实成功响应中的版本字段，错误透传 |
| 德州 `texas_replay.py`：目标房间游戏 RPC、聊天 RPC、两个确切 `pay_action` 动作 | 隔离带入、下注、查看公共牌和购买操作；真实订阅确认后注入有序消息，真实建房／删除仍执行 |
| 德州 `addon.py`／`texas_replay.py`：虚拟玩家资料、coin 钱包、100/1000 手统计、黑名单 | 只匹配虚拟 ID；本人资料、余额和统计透传；混合资料批次只查询真实本人再补虚拟玩家 |
| 德州 `room_view.py`：`GET /v1/room/room`、`PUT …/user_settings`、`GET …/hand_prediction/rule` | 把本轮私人房展示为大厅／游客视角，不改变服务端房间；保留自动补码和猜牌只读规则 |
| 德州 `ui_states.py`：`…/user_settings/{enable,disable}_auto_rebuy`、`…/hand_prediction`、`GET /v11/buy_in/room/applications`、RPC 错误 | 本房间开关／猜牌写隔离、申请空／待处理／已处理／分页、错误反馈；共用 auto-rebuy 暂缓优先 |
| 德州 `game_log.py`：本房间结算、局数、单局牌谱与用户 games | 旧版牌谱完整展示；仅本房间与虚拟局 ID |
| 德州 `records_v2.py`：`GET /v11/game_log/user/play_session_record/session`、`…/round/round` | 真实成功进入响应确认 session 后展示新版空／非空牌谱；版本覆盖仍保留上游失败 |
| 拼三张 `zhajinhua_replay.py`／`addon.py`：目标房间游戏和聊天 RPC、虚拟玩家资料、coin 钱包、本房间结算 | 独立三张牌协议、操作奖励和消息回放；只限本房间／虚拟 ID，不共享德州数据，保留带入及操作写隔离 |

## 浏览器初始化逐项分类

| 初始化项 | 决定 |
| --- | --- |
| 本轮真实 UI 登录后采集的认证缓存 | 保留；仅隔离上下文恢复真实会话，仍校验真实账户和应用已登录状态，不伪造用户或 token |
| 语言、设备 ID、浏览器语言规范化、游客主题缓存 | 保留环境配置；设备身份与账号分配一致，不进入代理响应逻辑 |
| 三类新手引导完成标记 | 当前仍作为页面／动画前置条件；能否由真实界面完成后移除注入尚未核实，不视为引导流程已验收 |
| 国家码 localStorage 强写 | 删除；只固定地域接口，由应用更新缓存 |
| `use.new.game.record.key` 强写 | 删除；Python 只覆盖真实成功版本接口，UI 用例等待应用写入所选版本并断言 |
| 静态禁动画、动画时钟、随机输入、单个暂缓 XHR 超时配置 | 保留既有采样工具；不模拟网络响应，动画套件继续断言真实运动和完整关键帧 |
| 余额、房号、昵称等截图文字稳定化 | 保留显示层规则及断言，不写业务认证／资产状态；每日奖励唯一的展示余额覆盖见上表 |

删除 `networkMocks.ts`、三个动画夹具模块、`walletPresentation.ts` 和只为旧钱包路由
服务的 `dailyBonusWallet.spec.ts`；后者的真实响应保留／错误不改成功已迁到 Python 回归。
删除失效的 `VISUAL_AUTH_USES_MITMPROXY` 选项；所有视觉登录采集现在默认经过代理。
没有生产夹具回调 TypeScript 的 HTTP/WebSocket 桥，也没有新增 Node 后备响应服务。
离线工具自测的 `.invalid` 页面／本机上游服务器继续保留，它们不服务生产测试流量。

### 运行来源与私有资料

新增夹具只使用 `laiwan_prd` 作为私有资料标识，不保存真实连接字面量。启动器复用既有账号工具的入口配置，通过真实的 `POST /public/v13/metadata/servers` 读取本轮节点，再以 `MITMPROXY_API_HOSTS` 传入确切主机列表。读取失败、契约无效或重定向均阻止启动，不补造节点或健康响应；代理没有有效列表时默认透传，也不把子域、相似域名或静态资源当成业务接口。

反馈来源通过 `MITMPROXY_FEEDBACK_ORIGIN` 明确输入；发布包运行时可从本轮包的反馈组件读取 staging 分支，按协议、主机和端口精确匹配。未提供来源时不拦截反馈请求。原有场景、账号、房间、方法和路径限制继续生效，真实登录、服务检查、预检和客服检查保持原有执行边界。

离线单元测试与真实代理集成统一使用 `.invalid` 来源和本机上游，不访问真实服务。代理诊断使用 `laiwan_prd` 加稳定散列区分节点，保留同一节点的关联能力，不输出真实主机或地址；请求正文与认证头仍不进入记录。
`visual/animations/renewReadiness.browser.ts` 和 `leaderboardReadiness.browser.ts`
仅在各自 `.invalid` 页面测试读取辅助函数的故障边界：页面由测试自行构造，响应与断连由该测试持有的
浏览器实例控制，生产场景没有导入或回调这些文件。动画工作流使用 Node 单独运行这些工具自测；
实际场景只导入 `renewReadiness.ts`、`leaderboardReadiness.ts`，两者只观察真实请求并点击真实入口，
不生成响应。保留响应顺序、旧请求晚到、单项完成、HTTP／业务失败、无效 JSON 及连接中断负例。
`e2e/cases/_shared/auth.ts` 的注册中止路由是直连功能登录的防写保护，不生成成功响应；
视觉注册防写已归 Python 环境边界。不能为消除这个保护而允许自动注册。

## 迁移核对与验证边界

本轮先保留基线接口与断言，迁移每日奖励钱包、分页、匹配／老虎机，再覆盖牌局回放调用。
与基线 `6ee4425` 逐字段比较了 76 组德州／拼三张牌桌输出（阶段、布局、行动方、看牌），
除动态 `sent_at` 外完全一致。回归同时验证钱包真实上游字段与错误、分页 12+3 和游标顺序、
WebSocket 混合批次中的订阅／心跳透传、RPC 回复顺序、注入方向及账号／房间隔离。
真实页面、静态截图和动画的既有断言与覆盖清单保留，未修改像素阈值或基准。

无凭据离线检查：

```sh
e2e/.venv/bin/python -m unittest discover -s e2e/mitmproxy -v
e2e/.venv/bin/python -m unittest discover -s visual/cases/texas-holdem/mitmproxy -v
e2e/.venv/bin/python -m unittest discover -s visual/cases/zhajinhua/mitmproxy -v
e2e/.venv/bin/python -m unittest discover -s visual/cases/game-record/mitmproxy -v
e2e/.venv/bin/python -m unittest discover -s visual/cases/club/mitmproxy -v
```

`test_response_overrides_integration.py` 启动五个真实 mitmdump 入口与本机上游，
验证场景启用／恢复、写隔离和所有候选节点／健康／预检透传。CI 继续固定 Release 构建身份，
沿用视觉全语言、动画三次比较、交互和真实 Freshchat 工作流，失败应保留完整报告。
`npm test` 额外检查应用场景与辅助代码不能重新引入 TS 响应路由或 HTTP 桥。

本轮模型沙箱禁止监听本地端口，初始依赖安装也因网络不可用失败；使用本机已有的
mitmproxy 12.2.3 缓存执行了纯 Python 回归：共用 34 项、德州 34 项、拼三张 19 项、
战绩 10 项、俱乐部 3 项通过；五入口端口集成因权限错误失败，没有跳过该测试。
JS/Python lint、ShellCheck、actionlint、400 行限制、两份 TypeScript 检查通过；
`npm run check` 原命令因 uv 缓存权限失败，改用已安装的对应版本单独执行静态检查。
`npm test` 125 项通过、5 项失败（4 项端口权限错误及 Release 工具自测的 Node 运行时
断言崩溃）；没有改动这些测试。用例收集为交互 16、动画 41、全量视觉 414 项。
端口集成、真实 UI 和迁移前后画面对比
尚未通过，必须由宿主／对应新构建 CI 验证；不能把用例收集或协议一致视为画面、原生设备
或远端回归通过。普通 CI 不自动接受新基准。当前没有可审阅的新构建截图或录像，
不作视觉批准，也不援引旧失败证明本轮成功或失败。

后续合并与修复记录见 [合并请求第 73 号的迁移回归调查](issue-70-regression.md)。

## 固定基线后的修复核查（#70）

本轮从固定基线 `5ee5469d4bde6202e9671e75701820253d0e13d7` 开始，工作树干净、无合并现场。
本仓库未发现 `AGENTS.md`、`AGENTS.txt`、`DEVELOPMENT.md` 或 `.codegraph/`，
按本仓库 README 和现有工作流执行；没有套用工具仓库的规则。
已解析恢复记录的原工作目录并只读确认其仍存在、HEAD 为 `12e280c4bfe3ee21eb74d8e90e53ee7e0f711d70`，未修改该现场。

对上次 `needs-repair` 的三个源码探针作了复核：

- 搜索夹具曾把未匹配关键词或方法改为 400，并伪造预检；现在仅命中确切 GET 搜索和 PUT 虚拟资料批次，其他请求及预检由上游处理。
- 空列表和骨架列表曾只检查 `user_id` 存在；现在必须已有账号绑定且查询值恰为唯一的所属账号。未绑定、其他账号、空值、重复参数、错误方法或来源均不生成列表响应。骨架动画在导航前绑定本轮真实登录态的账号，保留暂缓、释放、占位数量和动画断言。
- TypeScript 曾保留连接地址；现在与 Python 共用 `laiwan_prd` 主机散列标签，候选、选中、排除及代理历史重复清理后仍能关联。错误中的完整入口、裸主机、IP 和端口被隐藏，认证和请求正文继续排除；Python 的错误 URL 也不再保留入口路径。仅测试保留地址，不读取私有资料。

新增探针对基线 Python 模块在内存中加载运行，两个测试产生 19 个预期失败、无导入错误；
修复后均通过。TypeScript 脱敏与节点汇总回归也经历了先失败、修复后通过。
五入口真实代理集成增加上游响应头、完整正文和 HTTP 503 的透传负例；
列表与搜索未命中不能仅以单元测试中“没有本地响应”替代上游证据。

本轮实际本地验证及剩余边界见下方记录。固定检查及新提交远端结果仍须宿主核验，
不会将历史 PR 通过、用例收集、离线协议一致或本地回归当作当前完整验收。
引导初始化的真实界面替代、迁移前后完整画面对照和固定构建远端回归仍待独立验收；
上次记录中的建房价格读取取消深层原因仍未知，本轮未重新审阅远端附件，也没有据此修改 CI、业务断言或图片基准。

本轮最终检查记录：

- mitmproxy 12.2.3 依赖来自本机既有缓存：共用 43 项、德州 34 项、拼三张 19 项、战绩 10 项、俱乐部 3 项通过，共 109 项。共用套件另有一项五入口端口集成在监听时被沙箱拒绝，未通过、未跳过。
- TypeScript 脱敏／节点摘要四项、禁止 TS 响应路由检查一项通过。浏览器诊断回归在监听本机端口时返回 `EPERM`，未取得浏览器运行结果。
- ESLint、Ruff 0.15.12、ShellCheck 0.11.0、actionlint 1.7.12、400 行限制及根目录／视觉两份 TypeScript 检查通过；Python 与工作流工具使用已安装的对应版本直接执行。
- `npm run check` 原命令在 uv 缓存权限处失败；单独完整 `npm test` 为 140 项通过、5 项失败（四项本地端口权限错误，另一个 Release 工具测试进程触发 Node 运行时断言崩溃）。没有修改这些测试或将其标为通过。
- 本轮未执行 `npm ci` 或完整 pre-commit，不宣称宿主三项固定检查通过。新提交的端口集成、浏览器、全矩阵和真实客服验证由宿主继续执行；本轮无图片变更或视觉批准。

## 相对诊断路径补修（#70，基线 74a72bee）

本轮 HEAD 等于固定基线 `74a72bee2dd0ef53610ab04560ccd3a69108125f`，初始工作树干净、
没有合并现场。仓库没有 `AGENTS.md`、`AGENTS.txt`、`DEVELOPMENT.md` 或 `.codegraph/`；
已阅读本仓库 README、E2E／视觉／动画说明和适用工作流。
已解析两份恢复归档的完整 directory 并只读核对原目录：均存在，HEAD 分别为
`12e280c4bfe3ee21eb74d8e90e53ee7e0f711d70` 与 `a3fbd4c8bafc3f374bf8c2e8f5d52ff6753d6550`。

复现上次 needs-repair 的路径探针：TS 对相对路径跳过清理；Python 对 path 和 event
保留例外。仅用保留地址和合成凭据验证，新增回归在修复前失败，不代表发生过真实泄漏。
现在两端从 `data/diagnostic-paths.json` 只输出登记的逻辑接口模板，实体段替换为
`{user}`、`{room}` 等占位符；未知路径统一为 `[未知接口]`。查询和片段不输出，
编码或多层编码的实体也不复制到日志。必要的 `.json` 操作语义、metadata、健康、
建房及价格读取标识保留。该表只用于诊断，不参与请求匹配或响应构造；增加诊断操作时
应登记不含连接资料的模板，不能退回原样保存任意路径。
Python event 只接受本采集器的固定事件名。TS 回归还实际调用报告保存方法，覆盖
浏览器请求事件、应用事件、未清理代理历史、JSON／Markdown 附件及失败时终端摘要，
保留真实 HTTP 503、请求未完成和失败事件。

本轮验证结果：

- 定向 Node 回归 8 项通过；五组 Python 回归共 111 项通过，包含旧搜索范围、账号归属、写隔离与订阅顺序负例。五入口真实代理集成另有一项因本机监听权限被拒绝而失败，未跳过。
- 全仓 ESLint、Ruff 0.15.12、ShellCheck 0.11.0、actionlint 1.7.12、400 行检查和两份 TypeScript 类型检查通过。Python／Shell／工作流工具使用本机已有缓存中的固定版本。
- `npm run check` 在 uv 缓存权限处失败；单独 `npm test` 为 143 项通过、5 项失败：四项监听端口被拒绝，另一个 Release 工具测试进程触发 Node 运行时断言。没有把这些失败改成通过。
- 浏览器诊断回归在监听端口时返回 EPERM，未取得浏览器验证结果。未执行 `npm ci` 或完整 pre-commit，宿主仍须执行三项固定检查。

未读取本轮远端报告、截图或录像，不作视觉批准或当前 CI 通过结论。没有修改基准、
业务断言、比较门槛或应用仓库。引导注入的真实界面替代、迁移前后画面对照、固定构建
完整矩阵与真实客服验收仍待补齐；历史建房价格读取取消的根因仍未知。本次为可交付的
诊断边界修复，不代表 #70 全部验收完成，问题继续保留开放。
