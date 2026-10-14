# Android Staging 视觉回归

这里仅保存原生界面测试、截图基准和 Release 下载工具。应用源码和构建流程留在 `laiwan_react_native`；Woodpecker 将 APK 发布到 clrn 的 Release，APK 下载到被 Git 忽略的 `android/artifacts/current/`，不提交到 clrn。

## 测试内容

首批覆盖正常初始化后的登录入口、用户名登录、找回密码方式选择和邮箱找回密码表单。通过 Playwright 的 Android 原生控件驱动操作已安装 APK，不运行 H5，也不跳过应用初始化、不发送验证码。当前不覆盖登录后的牌桌和完整业务流程；这些页面后续扩展到本目录，不能直接套用 H5 基准图。

固定环境为 Android API 35、720×1280、320 dpi、字体比例 1、英文系统。GitHub Actions 使用 Ubuntu 和 x86_64 Google APIs 模拟器。正式基准应在相同 CI 环境生成并人工检查；本机 ARM 模拟器适合验证操作流程，渲染差异不能直接当作应用回归。

## 下载与本机执行

需要 Node.js 24 或更高版本、已认证的 `gh`、Android SDK 的 `adb` 和一个专用模拟器。把 SDK 的 `platform-tools` 加入 `PATH`。脚本要求显式指定模拟器编号，拒绝操作实体手机；每次运行会卸载并重新安装专用模拟器中的 `com.ac.laiwanDev` 测试应用。

```sh
npm ci
npx playwright install android
node android/download-release.mjs
ANDROID_SERIAL=emulator-5554 node android/run-visual.mjs
```

默认扫描已发布的 Android Staging Releases（包括 prerelease），选最新版本。指定旧版本重现问题：

```sh
ANDROID_RELEASE_TAG=android-visual-staging-7187-f00365042077 node android/download-release.mjs
```

下载后核对构建环境、应用标识、提交、架构、附件大小和 SHA-256；安装前再次校验，安装后检查版本。最新 Release 缺少附件会直接失败，不会悄悄退回旧版本。每次报告附带 `build-info.json`，用于确认实际测试的应用提交。

## GitHub Actions

工作流为 `Android Staging 视觉回归`。发布 Android Staging Release 后自动比较该标签对应的 APK；相关 PR 和 master 修改会比较最新 APK，也可手动指定标签。Release 触发入口在工作流合入 master 后生效。定时任务要求工作流存在于 GitHub 默认分支；仓库默认分支目前仍为 main，因此该定时入口暂不生效。此工作流与现有 H5 staging 部署验证独立，不修改 `deployments/staging.json`。

APK 与构建信息发布到 **clrn 自己的 Release**。下载步骤直接使用 GitHub Actions 内置的 `GITHUB_TOKEN`，工作流仅授予 `contents: read`，无需额外下载 Secret。Woodpecker 发布端的既有凭据需要 clrn Contents 读写权限。Release 附注标签明确指向 clrn master 分支的提交，应用提交只记录在标签说明和 `build-info.json` 中，不导入应用 Git 历史。首批测试无需账号 Secret。

比较失败时，从工作流产物下载 HTML 报告、实际图、预期图和差异图。附件保留 14 天，不重复上传完整 APK。缺失基准会失败，不会自动接受新截图。

## 更新基准

当前四张初始基准来自 [Android Staging Release 7187](https://github.com/kevinanew/clrn/releases/tag/android-visual-staging-7187-f00365042077)，由 [GitHub Actions reference 运行 38555441478](https://github.com/kevinanew/clrn/actions/runs/38555441478) 在上述固定环境生成，尺寸均为 720×1280。图片已逐张检查，包含完成初始化后的真实页面，没有加载态。基准保留 APK 当前外观：欢迎页与用户名登录页上的 Staging 提示仍会覆盖部分内容，用户名登录页底部条款与登录按钮也存在重叠。这些已有布局问题没有在本次测试接入中修复；后续应用修复后应重新审查并更新对应基准。

通过 GitHub CLI 指定包含工作流的分支和经确认的 Release 标签，生成候选基准：

```sh
gh workflow run android-visual.yml --repo kevinanew/clrn \
  --ref master -f mode=reference \
  -f release_tag=android-visual-staging-7187-f00365042077
```

在 PR 验证期间，将 `--ref master` 替换为 PR 分支。工作流至少运行过一次后可通过 CLI 指定分支；Actions 网页中的手动运行入口还要求工作流存在于默认分支。成功后下载 `android-staging-reference-*` 产物，审查图片，再将 PNG 放回 `android/snapshots/android-35-x86_64-720x1280-en/`，通过 PR 更新。reference 仅生成候选基准，不代表比较通过。

本机调试可显式生成参考图，保存在被 Git 忽略的 `android/snapshots/local/`，不覆盖 CI 正式基准：

```sh
ANDROID_SERIAL=emulator-5554 ANDROID_VISUAL_MODE=reference node android/run-visual.mjs
```

新增用例使用 APK 暴露的原生 `testID`，先等待目标控件就绪，再等待连续截图稳定。不要用坐标硬点、固定长等待、吞掉初始化失败或自动更新基准来让比较变绿。需要登录的后续案例必须接入现有账号池和账号级 concurrency，避免与 H5 用例互踢会话。
