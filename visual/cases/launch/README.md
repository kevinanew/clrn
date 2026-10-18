# 应用启动页

完整页面基准包含简体中文、繁体中文、英语，以及 375×812 手机和 1440×900 桌面视口：

- `launch-staging-notice`：首次启动时显示测试环境提示的完整页面，保留品牌背景、遮罩、全部提示与按钮。
- `launch-branding`：使用真实输入框和确认按钮继续后，应用等待初始化网络响应时的完整品牌启动画面。

通过网络边界暂缓 `/node/v1/status` 健康检查，并暂停浏览器时钟，稳定采集真实启动加载状态。截图不裁切、不遮罩、不删除组件、不修改页面样式。等待字体与本地图片加载、品牌淡入结束后采集；采集后释放请求并验证正常进入大厅。原来的启动动画帧独立保留。

沿用应用视觉测试矩阵及 CI，定向运行：

```sh
cd visual
VISUAL_FILTER=launch_ pnpm run test:all
```

Linux 基准通过 `visual.yml` 的手动任务生成：`suite=app`、`mode=reference`、`filter=launch_`；审查下载的完整 PNG 后提交，再以 `mode=compare` 验证。
