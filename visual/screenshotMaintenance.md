# 截图维护清单（#71）

检查起点：测试仓库 `4252b17`。固定应用构建沿用 `deployments/staging.json` 的
`9df567fda8d72f3742576256d5597523aff33171`，不修改应用仓库或网络夹具。
本清单记录代码与覆盖关系；真实应用运行结果以当前测试提交的 CI 为准。

## 比较与采集

原流程按应用、牌桌、独立战绩及额外刷新开关选择更新方式，`approve` 又有单独的更新分支。
现在所有普通截图均为：真实入口进入状态 → 就绪及稳定断言 → Chromium 截图 → 共用规则比较当前基准。
`test` 显式使用 `none`，缺图失败且不创建文件；`reference` 显式使用 `all`，保存所选状态的当前画面。
`approve` 只作为 `reference` 的兼容别名，不再声称能从上轮报告自动选择失败用例。

明确预期应用变化后，用 `VISUAL_FILTER` 选择对应状态所在场景，固定构建、语言、视口和 Linux
环境采集；逐图审阅实际图和差异后提交。不能对未知差异自动采集，也不因无意义波动批量替换图片。
正常比较继续使用 0.5% 差异比例，静态颜色容差 0.2、动画 0.1、素材 0；尺寸、有效面积和业务断言不变。
显式采集不以容差决定是否保留旧图，因此不再需要 `refresh_all` / `VISUAL_REFERENCE_UPDATE_ALL`。

| 入口 | 目的、调用方及证据 | 决定 |
| --- | --- | --- |
| `cases/runScenario.ts` | 通用场景准备、业务就绪及整页 `toHaveScreenshot` | 保留，一个状态对应一张当前图 |
| `cases/launch/launch.spec.ts` | 真正启动提示与加载页；固定时钟、完整视口及品牌文案断言 | 保留，不合并为普通禁动画场景 |
| `cases/club/searchResult.ts` | 搜索结果及真实交互断言后比较页面 | 保留，与俱乐部空态为不同业务状态 |
| `cases/wallet/transactions.ts` | 金币、钻石记录及页签断言 | 保留，失败图仅用于诊断 |
| `cases/game-record/ui.ts` | 两种引擎的空态、操作及结算状态 | 保留，不把不同业务状态当备用图 |
| `cases/texas-holdem/texas-holdem.spec.ts`、`cases/zhajinhua/capture.ts` | 真实建房、固定回放状态及各弹层 | 保留，房间归属、操作和清理断言不变 |
| `animations/timeline.ts` | 同一虚拟时刻稳定后比较，保留全部阶段差异和时间线 | 保留；像素差软断言最终仍使测试失败 |
| `animations/search-prompt.spec.ts` | 原搜索弹窗四帧及真实透明度 | 保留，未添加可接受相位 |
| `animations/imageFrames.ts` | 逐帧解码实际页面使用的 WebP，校验帧图、尺寸、时戳和时长 | 保留，不用两张起止图替代 |

没有发现备用基准列表、比较失败后更换截图来源或接受任意新旧图的分支。
报告中的原始图、差异图和未遮罩附件只用于审阅，不是可接受基准。
截图来源固定为当前 Playwright Chromium 页面；动画先固定画幅，不跟随运动主体重新裁切。
静态套件为三语言及两种视口，动画固定英文及两种视口，素材帧不重复按语言或视口存储。

## 动态内容与排除区域

以下均为已有规则，本次不扩大或新增。各普通场景的精确选择器和固定值仍以
`cases/*/scenarios.ts`、`scenarioTypes.ts` 及两份展示数据文件为唯一实现来源。

| 规则或区域 | 调用方、目的及覆盖证据 | 决定 |
| --- | --- | --- |
| `*-balance-text` | 私人房、账号、商城；固定展示余额，真实钱包由业务测试校验 | 保留集中展示规则，不改认证或响应 |
| `room-name-input`、九位房号 | 私人房输入及 `private-room/presentation.ts`；后者先校验真实房号格式 | 保留，复制按钮及标签仍在截图中 |
| 账号昵称、用户名、注册日期 | `account/presentation.ts`；保留本地化标签且校验日期格式；`tests/accountPresentation.spec.ts` | 保留，账号池身份不成为图片差异 |
| `nickname-input`、`bio-input` | 账号编辑场景，固定可编辑文本 | 保留，不遮住表单 |
| `CheckInDateListItem.checkInDetailDate` | 签到固定日期，通用截图入口另断言 `01/01` | 保留 |
| 两种牌桌房号及房名 | 各自 `scenarios.ts`，独立真实房间的展示标识 | 保留，房屋归属由代理和清理断言负责 |
| 两种牌桌昵称及排行榜昵称 | 德州 `texas-holdem-nickname-text`、`public-leader-board-item-nickname-*`；拼三张 `player_nickname` | 保留，列表、牌桌布局仍比较 |
| 公共及个人排行榜尾部 ID、`player-profile-id` | 各牌桌场景的非稳定身份文字 | 保留，不扩大到排行榜行或玩家区域 |
| `ping-screen-text`、`renew-popup-remain-diamond` | 牌桌延迟文字及续时展示余额 | 保留，网络诊断及钱包业务不使用这些固定文案作为真实数据 |
| `purchase-history-version-text`、`app-version-text`、`latest-version-text`、`current-server-text` | 钱包版本和关于页版本、测速选中节点编号 | 保留，不随构建更新无关画面 |
| `loading-indicator` | 反馈页的第三方内容加载提示 | 保留，限定反馈场景 |
| `new-version-need-update-text` | 关于页的远端版本提示 | 保留，限定关于页 |
| 视频及 `video-background-image` | `pageStabilizers.ts`，静态画面固定视频背景 | 保留，仅普通静态准备使用；动画套件禁止禁动画开关 |
| backdrop filter、私人房标题像素对齐、页面限宽 | `pageStabilizers.ts` 的 Linux 栅格化适配；`tests/preparePage.spec.ts` 验证返回栏、精灵画布和图标裁切 | 保留原边界，不因比较失败切换适配 |
| 遗留弹层隐藏 | `ensureSelectorGone` 仅在场景声明的离场目标上工作；浏览器回归检查不能隐藏应用根节点 | 保留原场景限制，不增加隐藏对象 |
| WebP 图像定位器遮罩 | `texasGameplay.ts` 全压时间线；火焰内部每帧由素材用例比较 | 保留，位置、主体运动与素材覆盖共同成立 |
| 最后入场帧的钱包数字字形 | `slotPopups.spec.ts`；真实余额响应、两个数字控件和最终值另有硬断言 | 保留当前最小区域；全采样帧动态余额问题由 #66 / PR #89 单独处理 |
| 手机玩家资料的下层背景 | `texasGameplay.ts` 的 `foregroundBelow`；保留顶部和当前弹层覆盖区 | 保留，不能遮住弹层；有效面积边界由 #67 / PR #85 继续验证 |
| 能量不足弹窗后的 `slot-banner` | `slotPopups.spec.ts` 的 `excludedBackground`；横幅旋转由 `ambient.spec.ts` 独立覆盖 | 保留，区域必须存在且不能与主体相交 |

## 初始化、等待与重试

语言、deviceId、引导标记和已采集的真实认证缓存用于明确初始状态；不直接调用应用组件方法。
静态禁动画脚本与动画虚拟时钟分开；动画保留 CSS 与 JS 原运动，关键帧、轨迹、透明度、重新打开
及释放遮罩的硬断言均保留。详细覆盖逐项映射仍见 [animations/COVERAGE.md](animations/COVERAGE.md)。

| 机制 | 已有范围与失败边界 | 决定 |
| --- | --- | --- |
| 整例失败重试 | 静态默认一次，动画原来零次 | 静态也改为零次，移除 `VISUAL_RETRIES` 配置 |
| 同一时刻相邻截图稳定性等待 | Playwright / `timeline.ts`；超时立即失败，不改变采样时刻 | 保留，不追加采样相位或重试整个用例 |
| 同源图片重新请求一次 | `ensureLocalImagesLoaded`，只对无可解码尺寸的同源图片；`tests/localImages.spec.ts` 验证缺图仍失败 | 保留原上限，不接受缺图为候选基准 |
| 建房导航重新选择一次 | `preparePage.ts`，只对建房表单就绪超时；其它场景不恢复 | 暂保留原上限，无新增；不能凭注释证明是测试缺陷，若原始失败需归因，不能更新基准 |
| 登录采集重试 | `captureAuthState.ts` 最多三次，上层进程最多两次；失败中止本轮 | 保留准备阶段的既有边界，各分片续期保持串行，不在场景中重登录 |
| 牌桌连接提示重试 | `tableSession.ts` 最多三次；仍失败保存诊断并抛错 | 保留现有上限，不因重构扩大；诊断记录每次尝试 |
| 图集等待与失败后时钟观察 | #68 的就绪断言、原始失败图和独立对照 | 全部保留，失败后观察不能把原用例改为成功 |

## 数量与等价覆盖

计数范围固定为 `buildScenarios({VISUAL_LOCALES:'all', VISUAL_SCOPE:'full', VISUAL_SUITE:'all'})`
及 `animations/snapshots`。静态清单与文件由 `snapshotLocations.test.ts` 一一核对；
英文关键帧清单、素材和原搜索四帧由现有动画测试核对。

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 静态场景 / 当前 PNG | 423 / 1437 | 423 / 1437 |
| 动画 PNG（含 1488 张页面关键帧、117 张素材帧） | 1605 | 1605 |
| 素材时序 JSON | 15 | 15 |
| 独立运行策略（test、reference、approve） | 3 | 2，approve 为别名 |
| reference 中按套件、战绩或额外开关选择更新方式的条件 | 3 | 0 |
| 刷新同一画面的额外工作流输入 / 环境开关 | 1 / 1 | 0 / 0 |
| 静态整例自动重试 | 1 | 0 |
| 备用基准 / 比较失败后截图来源回退 | 0 / 0 | 0 / 0 |
| 动画比较路径（普通含定位器遮罩、数字、局部前景、背景排除） | 4 | 4，逐项有调用和覆盖依据 |
| `run-visual.ts` 复杂度 / 嵌套历史例外 | 2 | 0 |

本次不删除截图、关键帧或业务断言，也不替换任何 PNG。减少的是运行与更新分支，不以基准数量
判断覆盖是否有用。每个现有状态仍映射原来的同一张图；旧版本由 Git 历史保存。

`snapshotPolicy.browser.ts` 使用临时图和真实 Playwright 验证：容差内差异比较不改图，显式采集保存
当前图，随后能比较通过；超限差异、尺寸错误、缺图及业务错误均失败且只有一次执行。
采集模式下业务错误仍失败。该回归进入 Linux 视觉工作流，机制验证不代替全量真实应用比较。
