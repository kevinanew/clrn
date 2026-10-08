# 德州视觉覆盖

测试访问已部署的 staging Web，对照 `laiwan_react_native` 源码 `45709ff3d` 的
`src/texas_holdem_react_native/main/MainScreen.js` 及其引用组件整理界面。
截图反映运行时的部署版本；源码中存在组件不等于部署版本有可用入口。

当前已提交的基准为每视口 61 张，共 366 张。新增 33 个状态的用例已加入清单，
但 198 张新基准尚未生成，不计作已完成的视觉覆盖。采集仍需解决 staging 连接波动、
测试账号现存等待牌局和补钻凭据缺失；完整性检查会保持失败，直到所有图片补齐。

补齐后的目标为每种语言 desktop/mobile 两个视口、每视口 94 张，共 564 张德州基准图。
三种语言为 `zh-Hans`、`zh-Hant`、`en`。场景清单以 [scenarios.ts](scenarios.ts) 为准，
新增状态必须同时提供六张 Linux 基准图，完整性测试会检查缺失和多余图片。

| 源码界面 / 数据状态 | 截图状态 |
| --- | --- |
| 等待牌桌、菜单 | `pre_game`: waiting_table、menu |
| 牌型、主题、游戏设置 | card_rank、theme、settings；`panels`: 三种额外牌面、三种桌布、settings_enabled |
| 带入、续费、带入申请 | buy_in、renew、buy_in_applications；buy_in_review |
| 升盲配置 | `optional_pre_game`: waiting_table、raise_blinds |
| 各轮牌桌、手牌强度 | `game`: preflop、flop、turn、river |
| 加注、精确加注、预选操作 | raise、accurate_raise、opponent_turn |
| 全下、摊牌、结算 | all_in、showdown、settlement |
| 本人/其他玩家资料、百手/千手统计、统计说明 | own_profile、player_profile、player_statistics_1000、statistics_help |
| 举报、屏蔽玩家 | report、block；chat_report、chat_block_confirm |
| 排行榜 | 空列表 leaderboard、有玩家 leaderboard_players、大厅 personal_leaderboard |
| 牌谱 | 旧版空牌谱 game_record、record_settlement、record_actions；新版 `records_v2`: empty、actions、settlement |
| 聊天、语音 | 表情 chat、快捷短语 chat_phrases、chat_history、chat_actions、voice |
| 结束后亮牌、查看剩余公共牌 | hand_end、remaining_cards、show_cards |
| 退出确认 | quit_confirm |
| 大厅专属工具栏、菜单 | hall_table、hall_menu |
| 自动补充筹码、合伙作弊举报 | auto_rebuy、pair_play_report |
| 下一手猜牌、猜牌结果、升级 | prediction、prediction_result、level_up |

以下为本轮新增用例，均待生成六张 Linux 基准图：

| 源码界面 / 数据状态 | 待采集截图状态 |
| --- | --- |
| 过牌、仅全下、全下与跟注、大小盲倍数快捷加注、禁用快捷按钮 | `controls`: check、all_in_only、all_in_call、shortcut_blinds、shortcut_disabled |
| 预选按钮及三种选中状态 | auto_buttons、auto_fold_selected、auto_call_selected、auto_check_selected；opponent_turn 也断言预选按钮实际显示 |
| 滑杆最大值、拖动辅助、精确金额、低于最小金额提示 | raise_maximum、raise_dragging、accurate_raise_value、accurate_raise_minimum_error |
| 观察者、九人满桌、保留座位、掉线、非房主菜单 | `table_states`: observer、full_table、reserved_seat、player_disconnected、guest_menu |
| 非空带入申请：待审批、通过/拒绝/过期、加载更多 | `panel_variants`: applications_pending、applications_resolved、applications_more |
| 语音历史行、弹幕关闭 | chat_audio_history、chat_barrage_off |
| 重试、余额不足、认证失败弹窗 | alert_retry、alert_insufficient_balance、alert_authentication_failed |
| 自动补码开启、已选举报玩家及理由 | `hall_variants`: auto_rebuy_enabled、pair_play_selected |
| 下注成功、猜牌亏损、钻石结果、加时冷却及提示 | prediction_bet、prediction_loss、prediction_diamond、delay_cooldown、delay_cooldown_alert |

## 代理边界

App 直连，德州只加载本目录 [proxy.ts](proxy.ts) 和 [mitmproxy/addon.py](mitmproxy/addon.py)。
E2E 故障代理的场景和脚本完全独立。共享部分只有进程管理、临时 CA 和本地控制客户端。
zhajinhua 应使用自己的目录及控制命令，方便分别调试。

每个分片通过真实 UI 登录一次，每例再通过真实 UI 创建私人房；大厅显示配置只修改这次成功创建的房间 UUID。
大厅自动入座在订阅前就被隔离，测试只建立真实观察者连接。
固定消息通过 mitmproxy 的 WebSocket 注入发送给浏览器，组件仍走实际 Centrifuge v2 恢复协议。
代理保留 ping、订阅、其他房间/用户消息以及混合批次中的其他 RPC。
回放房间的操作、查看公共牌和加时支付由夹具响应，不在服务端开局或真实下注。
申请列表、自动补码、猜牌操作及错误响应同样只匹配本例房间、准确路径和请求方法；
控制接口验证口令，解除回放时清空状态。非房主身份只修改本次已创建房间的详情响应。
资料、排行、牌谱夹具只匹配本房间与本例玩家。新版通过真实版本接口启用，
牌谱请求还必须匹配本次真实入房响应中的 play_session_id。结束时解除回放并删除本次房间。

页面时钟从导航前安装，连接后暂停并推进固定时间，等待翻牌、筹码动画及随机位置弹幕退场。
语音使用 Chromium 虚拟麦克风，仅截图弹窗，不录制或发送语音。
只有房号、昵称、余额、延迟等易变文本固定；不修改 React 组件实例或内部状态。
正式图片只在 Docker/Linux 生成；德州 reference 会重写所选状态，避免容差内的旧画面残留。临时 CA、登录态、网络请求正文不提交、不上传。

## 当前入口限制

以下界面尚无有效截图，不能把它们计入覆盖数：

- **RTC 面板**：`MainScreen._initializeState` 将 `allowPlayerRTC` 设为 false；
  `_renderRTCPanel` 依赖它，而 `_createChatRoom` 等待面板 ref。创建成功才将开关设为 true，
  因此存在首次初始化循环，正常 UI/聊天室推送不能打开面板。
- **猜牌记录**：`_queryRoomInfo` 更新 `allowBetNextHand` 后立即调用 `DrawerMenu.setOptions`，
  子组件读到旧 `showItemRecord`；之后没有随 props 更新重算选项。真实重连只刷新牌局状态，
  管理员入口也跳过记录菜单的插入。猜牌入口和结果本身已经覆盖。
- **换房匹配提示**：普通菜单过滤掉 rematch，源码标注其换房流程已失效。
  管理员、原生专属摄像头/录音状态和第三方客服内容不冒充普通 Web 界面。
- **系统静音说明**：`GameTopToolbar` 的 `isSystemMuted` 初始为 false，只有原生
  `react-native-volume-manager` 静音/铃声事件将其设为 true；Web 没有实际触发入口。

- **新版牌谱末尾符号说明**：当前 Web 动作列表未形成受约束的内部滚动区，
  设置列表 scrollTop 不移动内容，移动端末尾说明和底部分页被挤出视口。
  因此只覆盖实际空牌谱、动作、结算，不用与动作页完全相同的图片冒充独立符号页。
  结算页客服按钮覆盖部分公共牌也是当前部署的实际布局，基准保留该画面。

上游修复入口或布局后应补充对应场景及六张基准图，并保留真实 UI 打开方式。
