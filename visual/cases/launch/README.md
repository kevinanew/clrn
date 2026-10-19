# 应用启动页

完整页面基准包含简体中文、繁体中文、英语，以及 375×812 手机和 1440×900 桌面视口：

- `launch-staging-notice`：首次启动时显示测试环境提示的完整页面，保留品牌背景、遮罩、全部提示与按钮。
- `launch-branding`：使用真实输入框和确认按钮继续后，应用等待初始化网络响应时的完整品牌启动画面。

通过网络边界暂缓 `/node/v1/status` 健康检查，并暂停浏览器时钟，稳定采集真实启动加载状态。截图不裁切、不遮罩、不删除组件、不修改页面样式。等待字体与本地图片加载、品牌淡入结束后采集；采集后释放请求并验证正常进入大厅。原来的启动动画帧独立保留。系统语言与应用语言保持一致，并验证简中“来玩”、繁中“來玩”、英语“GoPlay360”。

截图前检查实际 `staging-dialog-surface` 面板的四边均在视口内，且水平、垂直中心与视口中心的误差不超过 1 像素。检查覆盖提示页和确认前的品牌页流程，在 compare 与 reference 模式下都执行，防止把越界或偏移的弹窗接受为新基准。`staging-dialog` 是全屏遮罩，不能用于代替面板几何检查。

当前测试固定使用 [修复版 Release `web-staging-7323-4d4d5a9c6a3e`](https://github.com/kevinanew/clrn/releases/tag/web-staging-7323-4d4d5a9c6a3e)，应用提交 `4d4d5a9c6a3ed10d243d53684b842540889be1b8`，包含 [弹窗修复 #7039](https://github.com/kevinanew/laiwan_react_native/pull/7039)。通过分支发布即可在合并 master 前运行 Linux reference；三种语言的完整启动页及受影响的手机页面、弹层和动画帧须生成、审查后提交。旧应用 `fcf7a0a22576923b0a2053154402cf39f68ccf3e` 的手机提示越界，会被新增断言拒绝。

沿用应用视觉测试矩阵及 CI，定向运行：

```sh
cd visual
VISUAL_FILTER=launch_ pnpm run test:all
```

Linux 基准通过 `visual.yml` 的手动任务生成：`suite=app`、`mode=reference`、`filter=launch_`；审查下载的完整 PNG 后提交，再以 `mode=compare` 验证。

应用修复把窄视口下的根容器限制在真实窗口宽度内，因此也会修正其他手机弹层的中心位置、右侧圆角及动画采样区域。本轮启动页基准来自 [Linux 启动页 reference](https://github.com/kevinanew/clrn/actions/runs/39208212622)，完整应用与动画分别通过 [应用 reference](https://github.com/kevinanew/clrn/actions/runs/39208596979) 和 [动画候选及连续比较](https://github.com/kevinanew/clrn/actions/runs/39208216629) 验证。所有任务使用上述同一 Release。
