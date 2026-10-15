# Android Staging 视觉回归

这里仅保存原生界面测试、截图基准和 Release 下载工具。应用源码和构建流程留在 `laiwan_react_native`；Woodpecker 将 APK 发布到 clrn 的 Release，APK 下载到被 Git 忽略的 `android/artifacts/current/`，不提交到 clrn。

## 测试内容

使用 Playwright Android 原生控件驱动操作正式构建的 Staging APK，正常完成初始化和真实账号登录。`scenarios.ts` 从 Web 的 `buildScenarios` 读取手机页面，共 70 个可达基础场景、三种语言，包含游客、认证、账号、社交、大厅、私人房建房表单、钱包和帮助页面。保留原有四张认证冒烟截图。网页的桌面留白不重复计入安卓覆盖；安卓截图独立保存，不能直接比较网页像素。

Web 另外有 5 个下载帮助场景。当前 Staging APK 的发布渠道为 `default`，原生 `SettingItems._listAndroidAdSectionItems` 仅在 `self-host` 渠道显示该入口，因此在 `unavailablePages` 明确列为不可达，不计入通过数量。

战绩直接复用 Web 的完整状态清单：旧版 32 个、新版 30 个状态，三种语言，共 186 张目标截图。覆盖加载、空列表、列表底部、分数选择汇总、侧滑删除、详情输赢展开、结算、回放入口、分页和故障恢复。与基础场景及冒烟图合计 400 张正式基准。德州完整 95 个状态、拼三张完整 26 个状态已接入同一份 Web 清单，涵盖操作控件、边池、旁观、聊天举报、带入审核、牌谱、主题、语音面板、大厅和故障恢复；三语合计目标 763 张截图。新增牌桌分支仍在原生验证，接入数量不等于通过数量。

网络代理直接调用 Web 的 `mockVisualNetworkDependencies`，复用商品、私人房、俱乐部等响应夹具；未匹配的请求继续访问真实服务。真实登录成功后，仅将本人昵称、展示用户名、注册日期和余额固定为 `visual/fixtures/account-presentation.json`，身份和令牌保持原值，失败响应不改成成功。普通页面测试不提交表单。牌桌组通过真实界面创建本轮专用私人房，复用 Web 的余额检查与清理；退出和失败时都解散该房间。仅测试账号余额不足时复用现有 testing 接口补钻，不执行真实充值。Web 和 Android 共用 `visual/fixtures/game-presentation.json` 中的展示房号；Android 仅覆盖本轮真实房间成功响应的 `options.house_number`，保留 UUID、房主、权限、房间状态及连接和清理请求。房号及复制图标完整参与截图比较。

固定环境为 Android API 35、720×1280、320 dpi、字体比例 1、英文系统。GitHub Actions 使用 Ubuntu 和 x86_64 Google APIs 模拟器。正式基准应在相同 CI 环境生成并人工检查；本机 ARM 模拟器适合验证操作流程，渲染差异不能直接当作应用回归。

## 下载与本机执行

需要 Node.js 24 或更高版本、已认证的 `gh`、Android SDK 的 `adb` 和一个专用模拟器。把 SDK 的 `platform-tools` 加入 `PATH`。脚本要求显式指定模拟器编号，拒绝操作实体手机；每次运行会卸载并重新安装专用模拟器中的 `com.ac.laiwanDev` 测试应用。

```sh
npm ci
python3 -m venv e2e/.venv
e2e/.venv/bin/python -m pip install -r e2e/mitmproxy/requirements.txt
npx playwright install android
node android/download-release.mjs
ANDROID_SERIAL=emulator-5554 ANDROID_GROUP=guest ANDROID_LOCALE=en node android/run-visual.mjs
```

默认扫描 `android-staging-<构建编号>-<提交前12位>` 格式的已发布 Android Staging Releases（包括 prerelease），下载 `android-staging.apk` 并选最新版本。指定版本重现问题（替换为实际标签）：

```sh
ANDROID_RELEASE_TAG='android-staging-<构建编号>-<提交前12位>' node android/download-release.mjs
```

下载后核对构建环境、应用标识、提交、架构、附件大小和 SHA-256；安装前再次校验，安装后检查版本。最新 Release 缺少附件会直接失败，不会悄悄退回旧版本。每次报告附带 `build-info.json`，用于确认实际测试的应用提交。

## GitHub Actions

工作流为 `Android Staging 视觉回归`。发布 Android Staging Release 后自动比较该标签对应的 APK；相关 PR 和 master 修改会比较最新 APK，也可手动指定标签。Release 触发入口在工作流合入 master 后生效。定时任务要求工作流存在于 GitHub 默认分支；仓库默认分支目前仍为 main，因此该定时入口暂不生效。此工作流与现有 H5 staging 部署验证独立，不修改 `deployments/staging.json`。

APK 与构建信息发布到 **clrn 自己的 Release**。下载步骤直接使用 GitHub Actions 内置的 `GITHUB_TOKEN`，工作流仅授予 `contents: read`，无需额外下载 Secret。Woodpecker 发布端的既有凭据需要 clrn Contents 读写权限。Release 附注标签明确指向 clrn master 分支的提交，应用提交只记录在标签说明和 `build-info.json` 中，不导入应用 Git 历史。登录场景使用现有 `CLRN_CI_TEST_ACCOUNTS` 账号池；八个业务组乘三种语言分别分配独占账号，并与 Web 共用账号级 concurrency，避免相互作废会话。

比较失败时，从工作流产物下载 HTML 报告、实际图、预期图和差异图。附件保留 14 天，不重复上传完整 APK。缺失基准会失败，不会自动接受新截图。

## 更新基准

正式基准必须来自固定的 x86_64 CI 环境，并逐图检查。reference 产物会同时携带仓库已有图片，因此只能接收该轮实际通过的场景，不能将整个目录直接覆盖到仓库。更新后必须另跑 compare；基准生成成功不代表回归比较通过。

应用修复集中在 [laiwan_react_native #7019](https://github.com/kevinanew/laiwan_react_native/pull/7019)。当前基准扩充和全量 compare 尚在验证，完成记录会同时注明测试提交、APK Release 及 CI 运行，未执行或失败的用例不计入通过数量。

拼三张三语全部 78 张基准来自 [reference 38673980189](https://github.com/kevinanew/clrn/actions/runs/38673980189)，使用 [APK 7235](https://github.com/kevinanew/clrn/releases/tag/android-staging-7235-72d60d0080df)，六个场景全部通过且已审查。独立比较结果另行记录。

通过 GitHub CLI 指定包含工作流的分支和经确认的 Release 标签，生成候选基准：

```sh
gh workflow run android-visual.yml --repo kevinanew/clrn \
  --ref master -f mode=reference \
  -f release_tag='android-staging-<构建编号>-<提交前12位>'
```

在 PR 验证期间，将 `--ref master` 替换为 PR 分支。工作流至少运行过一次后可通过 CLI 指定分支；Actions 网页中的手动运行入口还要求工作流存在于默认分支。成功后下载 `android-staging-reference-*` 产物，审查图片，再将 PNG 放回 `android/snapshots/android-35-x86_64-720x1280-<locale>/`，通过 PR 更新。reference 仅生成候选基准，不代表比较通过。

本机调试可显式生成参考图，保存在被 Git 忽略的 `android/snapshots/local/`，不覆盖 CI 正式基准：

```sh
ANDROID_SERIAL=emulator-5554 ANDROID_VISUAL_MODE=reference node android/run-visual.mjs
```

牌桌组在 JDK 17 环境构建固定 Playwright 1.61.1 官方提交的原生驱动，修正持续动画时的空闲等待、无障碍树空节点遍历，并增加直接读取目标节点的命令，避免短时提示消失前反复序列化整棵牌桌树。CI 自动读取并校验源码；本机先将官方提交 `39e3553a4f283a41134d75d7e404484bd9e6865a` 检出到 `.ttyctl/playwright-driver-source`，设置 `ANDROID_HOME` 后运行 `node android/build-driver.mjs`。补丁和 APK 均位于忽略目录，不修改被测应用或游戏时钟。

新增用例使用 APK 暴露的原生 `testID`，等待目标控件就绪和位置稳定后，在实时控件边界内点击或滑动，不依赖固定屏幕坐标。先等待业务就绪标记，再等待截图稳定；像素阈值保持 `maxDiffPixels: 0`。版本、日期、输入光标和横幅自动轮播图案采用显式小区域遮罩，报告同时保存原始截图与遮罩原因，遮罩面积超过 12% 会失败。

`ANDROID_GROUP` 支持 `guest`、`account`、`social`、`rooms`、`wallet-help`、`records`、`texas`、`zhajinhua` 和 `all`；`ANDROID_LOCALE` 支持 `en`、`zh-Hans`、`zh-Hant`。Actions 默认全组、全语言，也可用 `filter` 缩小调试范围。compare 每组出现三次失败即停止该组，reference 则继续遍历独立场景，报告中的未执行用例不计为通过。

代理仅绑定主机回环地址，控制接口和夹具服务使用每轮随机令牌。只对显式选定的专用模拟器安装临时 CA 和配置代理，结束时还原代理设置；此环境不应拿来运行个人应用。

统计说明等两秒短时提示采用连续 250 毫秒稳定检查，并断言提示在每次截图前后都可见；普通页面继续要求连续两秒稳定，所有截图仍要求零差异像素。

拼三张比牌选择框会独立闪烁，采用分区相位比较：保留一张完整真实截图作基准，页面其余像素须连续稳定两秒并匹配基准；四个玩家区域各自在真实动画帧中匹配对应区域。使用与普通截图相同的 Playwright 比较器、`threshold: 0.1` 和 `maxDiffPixels: 0`，不遮掉玩家内容，也不合成不同时间的截图。报告附上区域定义及各区域匹配时的完整原图，所有像素都有对应比较。

原生套件关闭 Playwright 的后台 WebView 发现；后台 ADB 探测失败会关闭整个设备连接，而本套件不使用浏览器调试接口。原生操作、截图及应用错误仍正常失败，不自动重试场景。

列表滚动固定后，三语高级建房基准来自 [38674831805](https://github.com/kevinanew/clrn/actions/runs/38674831805) 的八个通过场景和 [38675676317](https://github.com/kevinanew/clrn/actions/runs/38675676317) 的简体德州场景；三语新版战绩页脚来自完整通过的 [38674838931](https://github.com/kevinanew/clrn/actions/runs/38674838931)，其余 87 张新版战绩图与原基准匹配。
