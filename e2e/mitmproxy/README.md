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
| 同上：`GET /v10/club?user_id=…` | 俱乐部空态 | 仅 `club-empty` 场景保留；其他视觉场景透传或交给专用虚拟俱乐部 addon |
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
| `animations/skeleton.spec.ts`：俱乐部列表和详情 | 两条骨架脉冲动画 | `club-skeleton`；仅固定列表与确切虚拟详情批次，`hold/release` 控制等待 |
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
| 同上：`GET /v10/club/search?keyword=…`、`PUT /v10/clubs` | 精确关键词与虚拟俱乐部 ID 的只读命中卡片；功能和视觉共用 |
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
| 三类新手引导完成标记 | 保留聚焦页面／动画的环境前置条件；不覆盖引导本身，也不冒充业务响应 |
| 国家码 localStorage 强写 | 删除；只固定地域接口，由应用更新缓存 |
| `use.new.game.record.key` 强写 | 删除；Python 只覆盖真实成功版本接口，UI 用例等待应用写入所选版本并断言 |
| 静态禁动画、动画时钟、随机输入、单个暂缓 XHR 超时配置 | 保留既有采样工具；不模拟网络响应，动画套件继续断言真实运动和完整关键帧 |
| 余额、房号、昵称等截图文字稳定化 | 保留显示层规则及断言，不写业务认证／资产状态；每日奖励唯一的展示余额覆盖见上表 |

删除 `networkMocks.ts`、三个动画夹具模块、`walletPresentation.ts` 和只为旧钱包路由
服务的 `dailyBonusWallet.spec.ts`；后者的真实响应保留／错误不改成功已迁到 Python 回归。
删除失效的 `VISUAL_AUTH_USES_MITMPROXY` 选项；所有视觉登录采集现在默认经过代理。
没有生产夹具回调 TypeScript 的 HTTP/WebSocket 桥，也没有新增 Node 后备响应服务。
离线工具自测的 `.invalid` 页面／本机上游服务器继续保留，它们不服务生产测试流量。
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
