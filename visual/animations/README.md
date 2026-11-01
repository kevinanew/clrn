# H5 动画视觉回归

CI 使用本轮 Release 的独立静态服务器，连接 Staging 后端，通过真实按钮和房间消息触发动画；候选基准与比较步骤固定使用同一构建包，独立于静态视觉套件。
正常动画场景透传完整节点列表和真实健康响应，由应用动态选线；本地代理只隔离本轮房间消息与业务夹具。
覆盖范围与平台例外见 [COVERAGE.md](COVERAGE.md)。浏览器固定为 Playwright 1.61.1 的
Linux Chromium、英文、DPR 1，使用手机 375×812 和桌面 1440×900 两种视口。

动画截图只保留 `en` 一套；运行器、应用初始化与文件命名均固定英文，不读取外部的多语言设置。普通页面截图继续保留三语言。无文字的素材帧仍共用一套。

## 运行

```bash
docker compose -f visual/docker-compose.yml build visual
npm --prefix visual run test:animations

# 单套件：app、texas、zhajinhua；默认依次运行三组
VISUAL_SUITE=app npm --prefix visual run test:animations

# 从新页面重复验证，不通过失败重试掩盖不稳定
npm --prefix visual run test:animations -- --repeat-each=3

# 生成候选基准；检查图片后再提交
npm --prefix visual run test:animations -- --update-snapshots
```

缺失基准在普通比较中直接失败。正式基准只在 Docker/Linux 生成。
`baseline-inventory.json` 登记已审查的英文动画关键帧，普通代码 CI 也逐项核对磁盘文件：
缺帧、遗留中文动画或未登记的动画都会失败。新增动画需同时更新清单与真实采集图；
无语言素材和普通页面的三语言基准不参与该迁移。
运行器为每组先采集登录态，再运行用例；CI 将应用拆为两组、德州拆为三组、拼三张拆为两组，每组使用独立账号，账号锁与其他回归共用。
牌桌测试通过真实入口创建独立房间，消息回放和 RPC 夹具只绑定该房间，结束或断言失败均解散。
测试账号建房余额不足时，沿用现有 `TESTING_API_TOKEN` 补充机制。

## 采样方式

- `timeline.ts` 用 Playwright 时钟推进 JS 动画，用 Web Animations API 定位 CSS 动画时间。
  JS 时钟每次最多推进 16ms，让 React 定时副作用在帧间提交，避免长时间跳步合并倒计时更新。
  CSS 动画挂载时立即暂停，避免较慢机器在开始采样前已经播完淡入。
  保留 `animations: allow`，检查未启用 `__VISUAL_REGRESSION__` 或禁动画样式。
- 常规面板采样 0、80、160、320、640、1200ms。BottomSheet 下一帧挂载，入场文件名记录
  实际起点偏移 16ms。长动画另有明确的时间点，不根据当前实现时长自动缩放。
- 面板先真实打开、关闭以预热图片，再截入场和退场，最后重开验证遮罩释放。
  牌桌定时动画的准备阶段可快进，正式关键帧始终逐帧推进；弹簧抽屉的准备也逐帧推进。
  采样读取位置、透明度、变换；要求主体发生运动，避免把背景变化误当成面板动画。
- 固定画幅不跟随目标移动，位置错误不会因动态裁切被抵消。像素差比例上限 0.5%，
  颜色阈值 0.1。每个虚拟时刻按同一规则确认相邻截图稳定，再比较基准，避免截到布局尚未提交的画面。
  每帧在暂停时钟的状态下等待新挂载的同源图片加载完成，避免把资源加载速度误当成动画变化。
  随后等待浏览器布局通知并执行同一时刻的零延迟回调，使 RN Web 图片尺寸和滑杆测量完成；
  这一步不推进动画时钟，也不改写组件布局。
  德州单独等待牌面时也等待真实图片解码与布局提交，再确认文字回退层已经消失；
  图片已下载或已有原始尺寸，不能单独证明图集组件已经就绪。
  像素差异使用软断言记录：同一用例继续采集后续关键帧和牌局阶段，最后仍以失败结束，
  报告保留每张不一致截图及完整时间线。资源加载、截图稳定性、业务状态和主体运动断言
  仍立即中止；不能把无效页面继续当成可审查的候选图。普通比较不创建或修改基准。
  普通、局部区域、排除背景及数字遮罩分支的稳定性检查均使用颜色阈值 0.1 和差异比例 0.5%，
  不要求 PNG 压缩字节完全相同，避免把允许范围内的绘制微差当成持续动画。
  局部比较按有效面积计算，定位器遮罩、数字遮罩与背景排除区域不计入分母，重叠遮罩只排除一次；
  不改变原有遮罩位置、大小或主体运动断言。完整规则见[图片比较统一规则](../screenshotComparison.md)。
  原有游客搜索四帧用例和透明度断言继续保留。
- 表情、道具落点及火焰使用浏览器解码的 WebP，内部时间不受 JS 时钟控制。
  `imageFrames.ts` 比较实际页面加载素材的每一帧、尺寸、时间戳和帧时长；素材帧逐像素比较，差异比例上限同为 0.5%，颜色阈值保持为 0。
  原始素材帧只在手机项目比较一次，道具飞行在两种视口分别使用真实牌桌截图验证。
  全压时间线遮罩 WebP 区域，其内部图像由素材用例负责。
  这部分不声称验证浏览器实时解码播放的调度精度。
- 夹具固定匹配与老虎机响应，避免进入真实匹配队列或实际抽奖；只固定业务数据和必要的随机输入，
  不调用应用内部状态、组件方法，不向业务源码增加测试分支。
  HTTP、WebSocket RPC 及牌局消息由 Python addon 生成；用例只发送具名场景命令。
  数据文件、迁移前后协议核对及保留原因见[网络夹具清单](../../e2e/mitmproxy/README.md)。
  拼三张结算使用固定随机种子，各金币仍保留不同轨迹；加注气泡在图片加载完成后采样。
  倒计时使用牌局实际生效的操作时限并断言首尾数字；拼三张先通过新一局消息清除结算皇冠。
  摊牌等待真实牌面替换加载备用图，道具等待飞行图片就绪；语音等待权限检查后挂载，
  再以固定步长推进时间，避免异步准备过程改变首帧相位。
  加载动画暂缓的单个 XHR 请求另设 120 秒真实网络超时：XHR 不受 JS 时钟控制，
  不能让慢机器的截图耗时触发业务超时。动画采样仍为 0–1600ms，结束后恢复请求行为。

已完成的 CSS 动画使用 `finish()` 归还控制，不能 `play()` 重启退场动画。
部分抽屉关闭后保留 DOM；测试检查透明度或视口外位置，并再次真实点击入口。

## CI 与报告

`H5 动画视觉回归` 支持 PR、master 更新、手动和部署后触发，七个分片独立运行，每个分片比较三遍，零重试。
HTML 报告位于 `visual/playwright-report/animations/<suite>/`，失败图片和时间线附件位于
`visual/test-results/animations/<suite>/`，CI 保存 14 天。
每个新增用例附带实际加载的构建版本；设置 `CLRN_EXPECTED_APPLICATION_COMMIT` 时会在采样前核对版本。
手动运行工作流可启用 `update_snapshots`，在 CI 生成候选图后连续比较三次。
也可用 `suite` 只验证发生变化的套件；候选图在比较前单独上传，便于提前检查。
候选图只上传 artifact，下载检查后再纳入仓库；普通 PR、部署和手动比较不会自动更新基准。

关键帧比较用于检测外观、进度和终态变化，不衡量真实设备帧率。

## 连接失败诊断

德州、拼三张的动画和画面测试会在导航前开始采集，并在清理房间前保存：

- `connection-summary.md`：节点汇总、最近操作与网络事件；CI 作业摘要也会展示，失败用例优先。
- `connection-diagnostics.json`：完整的有界时间线（最多保留最近 5000 条，超出明确标记），包含请求编号、节点、方法、路径、状态和耗时。
- 节点列表区分 v12 牌桌列表、v13 启动列表及代理过滤前后；健康响应区分真实上游和测试代理模拟。
- 应用构建带有 `laiwan:connection-diagnostic` 事件时，还能查看失败缓存、候选排除、选中线路和断线切换原因。旧构建会明确提示这些决策未知，不能从“没看到请求”推断缓存命中。
- WebSocket 记录连接、关闭码及订阅/RPC 的编号与结果，不保存认证帧和游戏消息正文。浏览器发出请求不代表上游一定收到，服务端确认仍须结合后端日志。

所有新增诊断仅以 `laiwan_prd` 加稳定散列标识节点；浏览器、应用事件及 Python 代理对同一节点使用同一标签。连接主机、端口、完整入口、认证参数及业务正文不进入诊断附件，保留逻辑接口路径和可核实状态。采集时间使用测试进程的真实时间，不受动画虚拟时钟影响。

## 牌面图集超时诊断（#68）

德州在导航前安装只读 DOM 观察器，`card-sprite-diagnostics.json` 保留最近 1000 条变化，
超出计入 `dropped`。记录匿名牌槽、图集容器和图片编号，挂载／移除、布局、资源指纹、
图片原始尺寸与 DOM 解码结果、翻转侧、回退层 display、内容 opacity 和裁切 transform。
记录不包含玩家 ID、牌桌正文、图片数据 URI 或 URL 查询参数。宿主收到事件的真实时间
与页面虚拟时间分别保存；应用版本、Release、CI 测试提交、运行编号、视口及重复序号随附件保存。

就绪等待仍使用原有 10 秒硬断言和 `runFor(0)`，不改写组件或推进关键帧。
全押、摊牌回放之前及每次解码、布局提交前后均有采样点。解码结果仅指 DOM 中的图片，
不能据此推断 RN Web 内部独立 ImageLoader 的回调或 React 状态已经提交。

图集断言失败时，先保存原始 `failure.png` 和 `card-sprite-diagnostics-frozen.json`，
再在同一构建、同一 DOM 上恢复 JS 时钟正常速度，采集 0–1200ms 的诊断观察。
最终附件包含该观察；即使回退层之后消失，原用例仍抛出原始错误，不继续采样、比较或修改基准。
CSS 采样暂停保持原状，因此这是 JS 时钟恢复后的顺序观察，不能代替从新页面开始的独立对照，
也不能单凭恢复断定原故障属于测试。若节点被替换，应通过匿名编号区别恢复与重挂载。

### 独立新页面取证

手动工作流可指定 `release_record`（完整固定发布记录 JSON）与
`expected_application_commit`，沿用下载、大小、SHA-256、build-info 和页面版本核验。
原 #68 构建记录位于 Git 提交 `6ee4425bd4916705c2db84b8f1b8438021b5800e`
的 `deployments/staging.json`，预期应用提交为
`69f9251d3b5f2b93aa2d880d27abbeefe16ee645`。不要使用当前默认构建替代该记录。
选择 `suite=texas` 或 `all` 并启用 `card_sprite_control`，在原比较结束后额外运行
`cardSpriteControl.spec.ts`，原比较失败时也会收集对照；任何一步失败都保留失败结果。

本机在准备好同一固定 Release 并设置准备命令输出的三项环境变量后，可以运行：

```sh
VISUAL_SUITE=texas ANIMATION_PART=card-sprite-control node scripts/with-test-account.mjs -- \
  node scripts/with-release-web-server.mjs npm --prefix visual run test:animations:ci -- --repeat-each=3
```

两种模式各用新的 context、页面和真实房间，从相同翻牌前状态经公共牌到全押、摊牌。
每遍交替顺序，手机和桌面各三遍、每遍两种模式，零失败重试。
`normal` 不安装 Playwright 时钟、不暂停 CSS；推进动作只等待对应真实时间，布局等待
不调用 `runFor(0)`。`frozen` 沿用现有暂停、CSS 与真实网络配速策略。
两者都使用原有图集 10 秒硬断言，不生成或比较候选基准，也不替代原动画用例。
这是聚焦图集的独立牌局对照：没有复现原玩法用例的完整倒计时、动作和弹层历史，
即使全部成功也不能宣称原失败已经排除或完成根因归属。

独立报告保存到 `visual/test-results/card-sprite-control/` 与
`visual/playwright-report/card-sprite-control/`，不会清空原动画失败工件。
附件包含时钟模式、构建／测试／重复身份、时间线和成功／失败截图。
正常时间页的原始失败为 `card-sprite-diagnostics-normal-failure.json`；不会恢复或替换其时钟。

普通动画配置的手机、桌面项目均排除独立对照，桌面继续排除旧搜索提示用例。
独立配置显式清除继承的项目级排除，仅收集两种视口的对照。
`collection.test.ts` 用真实 Playwright CLI 的 `--list` 核对全部原普通用例和独立入口，
随 `npm test` 执行；当前普通配置 41 项、9 个文件，独立配置 4 项、三遍重复 12 项。
这些数字仅表示收集结果，不代表浏览器、真实牌局或原生设备运行通过。

独立页还通过 React DevTools 提交协议观察组件匿名身份、提交和移除，以及符合已知
SpriteImage 结构的三个状态值（visible、scaleX、scaleY）。只读取，不调用组件回调或 setter；
不保存 props、牌名、玩家或任意 hook 值。已有开发工具 hook 不覆盖；未知 renderer、
未识别组件和截断明确标记，独立用例不会把这些情况当作生命周期取证完成。
这是额外的观察环境，需核对固定构建是否支持及观察器是否影响复现；它没有直接观测
RN Web 独立 ImageLoader 回调的进入／返回，组件 visible 的提交也不能单独解释根因。

图集图片路径在宿主持久化前统一变为 `asset-<指纹>`；包括路径内嵌地址、编码、凭据
和 data URI。仅按稳定逻辑标识关联，私有资料来源仍仅标为 `laiwan_prd`。

历史证据及尚未知项见 [issue-68-investigation.md](issue-68-investigation.md)。
离线浏览器回归增加 `cardSpriteDiagnostics.browser.ts`，覆盖定时回调恢复、持续回退、
原始失败保留、DOM 移除和脱敏；这些夹具不代表真实应用或原生设备回归通过。

离线验证（无需登录或访问 staging）：

```sh
node --import tsx --test e2e/helpers/diagnostic-recorder.test.ts
node --import tsx --test e2e/helpers/connection-diagnostics.browser.ts
node --import tsx --test visual/animations/timeline.browser.ts
node --import tsx --test visual/animations/cardSpriteDiagnostics.browser.ts
node --import tsx --test visual/animations/cardSpriteClock.browser.ts
node --import tsx --test visual/animations/cardSpritePrivacy.test.ts visual/animations/cardSpriteLifecycle.test.ts
# 使用系统 Chrome 时设置 DIAGNOSTIC_CHROME_PATH 为浏览器可执行文件路径。
e2e/.venv/bin/python -m unittest discover -s e2e/mitmproxy -v
```
