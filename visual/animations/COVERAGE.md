# 动画覆盖清单

范围：本仓库负责的线上 H5。基准目标部署为 `2a447047bdb28d1536dad5915374d6527055dcb4`。
下表记录已实现的用例入口；当前仍在生成候选基准和全量验证，不能据此宣称全部已通过。

| 效果 | 用例 / 关键帧前缀 | 检查范围 |
| --- | --- | --- |
| 启动品牌淡入 | `ambient.spec.ts` / `launch-branding` | 初始透明、中间帧、500ms 完成 |
| 测试版提示及分享链接确认 | `dialogs.spec.ts` | Paper Dialog 淡入/缩放，分享确认退场及重开；启动提示确认后进入大厅 |
| 大厅老虎机横幅 | `ambient.spec.ts` / `hall-slot-banner` | 自动旋转及下一轮 |
| 搜索确认弹窗 | `application.spec.ts`、`search-prompt.spec.ts` | 淡入、淡出、重开、实际透明度 |
| 俱乐部更多菜单 | `application.spec.ts` / `club-more` | 入退场及重开 |
| 邀请朋友底部抽屉 | `application.spec.ts` / `invite-friends` | 位移、透明度、退场后入口 |
| 创建房间玩法选择器 | `application.spec.ts` / `game-picker` | BottomSheet 入退场 |
| 俱乐部空态 | `application.spec.ts` / `club-empty` | Moti 内容淡入 |
| 大厅匹配 | `application.spec.ts` / `hall-matching` | CSS 旋转、展示及取消 |
| 俱乐部列表骨架 | `skeleton.spec.ts` / `club-list-skeleton` | 响应暂缓时脉动，释放后真实列表 |
| 完整老虎机 | `slot.spec.ts` / `slot-*` | 三个滚轮、金币/钻石/能量奖励 |
| 老虎机面板及能量不足提示 | `slotPopups.spec.ts` | 入退场、实际错误响应触发 |
| 两种牌桌菜单、牌型、主题、设置 | `tablePanels.ts` | 每个入口分别入退场和重开 |
| 两种牌桌带入、续费、排行榜、牌谱、聊天、申请 | `tablePanels.ts` | 各面板入退场和遮罩释放 |
| 拼三张空座引导箭头 | `tablePanels.ts` / `zhajinhua-seat-guides` | 循环关键帧 |
| 德州公共牌 | `texasGameplay.ts` / `texas-flop/turn/river` | 翻牌、转牌、河牌及牌面断言 |
| 德州玩家行动 | `texasGameplay.ts` / `texas-call/raise/check/fold` | 状态、下注及筹码变化 |
| 德州倒计时及操作区切换 | `texasGameplay.ts` / `texas-countdown-operation-switch` | 计时进度及操作区变换 |
| 德州加注、精确加注、玩家资料 | `texasGameplay.ts` | 入退场及重开 |
| 德州全压、摊牌、结算 | `texasGameplay.ts` | 手牌、皇冠、净收益、余额；火焰素材另测 |
| 经验与升级 | `texasGameplay.ts` / `texas-experience-level-up` | 真实操作响应触发，展示与离场 |
| 拼三张发牌、看牌、加注、比牌、摊牌、结算 | `zhajinhuaGameplay.ts` | 十五张牌的飞行、翻牌、比牌往返、胜负、余额 |
| 拼三张精确加注、比牌目标闪烁 | `zhajinhuaGameplay.ts` | 精确加注入退场、四个目标循环闪烁 |
| 弹幕 | `texasSocial.ts` / `texas-barrage` | 固定随机高度后的真实移动轨迹 |
| 消息操作、举报、屏蔽、语音 | `texasSocial.ts` | 入退场；不发送录音或举报 |
| 带入审核及错误提示 | `texasSocial.ts` | 房间消息/失败响应触发入退场 |
| 自动补充带入、合谋举报、个人排行榜 | `texasHall.ts` | 现有大厅响应夹具下的真实入口 |
| 系统提示、加载中 | `texasFeedback.ts` | 消息触发提示淡入和消失；暂缓响应下双层旋转 |
| 全部 7 种表情、7 种道具、全压火焰 | `texasAssets.ts`、`imageFrames.ts` | 真实素材逐帧与时长；道具飞行轨迹 |

## 平台差异与当前不可达的入口

- 德州 H5 的轻量模式关闭金币粒子、胜利背景序列以及部分发牌/空座箭头动画。
  测试不得改写 `Device.isWeb` 强行打开；保留 H5 实际效果与静态断言。
- `TreasureBox` 在当前源码仅有导出，没有实际消费入口；不能以直接挂载测试组件冒充正常页面覆盖。
- 独立 `MatchTexasHoldem` 热气球页面依赖浮窗匹配状态，现有 H5 场景不可达。
- RTC、下一手下注记录、重新匹配、拼三张独立加注滑杆的入口限制沿用各牌桌已有 `COVERAGE.md`。
- 俱乐部房间骨架仅用于旧引擎房间缺失信息的分支。当前 React Native 引擎响应在构造时即设置
  `isAllInformationLoaded=true`，旧版德州已下线。
- React Navigation 的 Stack 在 Web 平台默认使用 `animation: none`。实际账号安全页入栈采样也没有位移或渐变，
  因此不将普通导航列为已覆盖动画，不强制打开原生平台的转场。
- 原生专属动画属于 `clrn-az` 范围，不由本仓库的 H5 截图证明。
