# 拼三张视觉覆盖

拼三张单独使用 `VISUAL_SUITE=zhajinhua`、账号 `laiwanvisualzjh01` 和本目录代理。
三语言 × 桌面/手机 × 26 个状态 = 156 张 Linux 基准；全部纳入核心 CI。
建房表单仍由 App 场景覆盖。运行：`cd visual && pnpm run test:zhajinhua`。

| 流程 | 截图状态 |
| --- | --- |
| 真实私人房开局前 | waiting_table、menu、card_rank、theme、settings、buy_in、renew、leaderboard、game_record、chat、buy_in_applications |
| 主题与设置 | theme_four_color、theme_four_color_two、theme_realistic、table_blue、table_purple、table_black、settings_enabled |
| 三张手牌与操作 | blind_cards、seen_cards、quick_raise、accurate_raise、challenge_select、opponent_turn |
| 摊牌与结算 | showdown、settlement |

每例通过真实 UI 创建房间，进入真实游戏连接。开局前截图不启动房间计时、不带入。
牌局过程通过本目录 `zhajinhua_replay.py` 使用 Centrifuge v2 publication 回放，
三张手牌、轮数、单底池、比牌选择使用拼三张协议，不引用德州回放或数据夹具。
面板由实际 UI 打开，不注入组件状态。回放只接受本例成功建房响应的 UUID，
只隔离该房间的操作 RPC，保留其他房间、订阅、ping 及混合批次中的其他请求。
RPC 可走连接池中未订阅该频道的连接，因此按已确认归属的房间 UUID 隔离，不按发送连接过滤。
结束时先直连删除本次创建的房间，再解除回放；失败时也清理。

牌局回放时暂停页面时钟、推进动画完成时间；开局前沿用德州的正常页面时钟。
开局前空座位的引导箭头通过 JS transform 循环运动，截图仅固定其初始位置；
仍校验九个箭头的存在与原始尺寸，不隐藏引导或修改桌面布局。
截图固定房号、房间名、余额和延迟。
`0ms` 是截图固定文案。代理只固定 staging 网络节点和本例回放玩家资料。
正式基准仅在 Docker/Linux 中生成；登录态、临时 CA、请求正文不提交。

## 当前边界

- **手机布局**：375×812 的牌局中，房间名与快捷加注按钮重叠；Linux 闷牌截图已复现。
  基准保留当前线上布局，不通过遮罩或调整应用样式掩盖问题。
- **牌型关闭**：Linux 繁中桌面曾出现透明层拦截关闭图标点击，截图中图标仍可见。
  本轮使用该弹窗已有的遮罩关闭入口推进截图流程，不验证关闭图标的点击行为。
- **滑杆加注弹窗**：当前 `MainScreen._onPressRaise` 和 `_onPressShortcut` 直接调用 `_raise`，
  `RaiseBetPopup` 没有 UI 打开入口。覆盖实际快捷加注及精确加注，不伪造该弹窗截图。
- 大厅专属自动补充筹码、合伙作弊举报、升级、玩家资料、语音、聊天历史、非空牌谱、
  带入审核、比牌动画和可选规则尚未纳入本轮场景，不能按德州覆盖数算入拼三张。
- 当前回放使用私人九座桌、五位玩家，真实服务端房间保持等待状态，不在服务端开局或下注。
  建房仍消耗 staging 钻石，余额不足时沿用固定账号的补钻机制。

补充范围时应增加实际 UI 流程、明确就绪断言和对应的六张 Linux 基准。
