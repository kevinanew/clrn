# H5 动画视觉回归

本目录访问正常部署的 staging，使用真实按钮和房间消息触发动画，独立于静态视觉套件。
覆盖范围与平台例外见 [COVERAGE.md](COVERAGE.md)。浏览器固定为 Playwright 1.61.1 的
Linux Chromium、简中、DPR 1，使用手机 375×812 和桌面 1440×900 两种视口。

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
运行器为每组先采集登录态，再运行用例；CI 为三组分配不同账号，账号锁与其他回归共用。
牌桌测试通过真实入口创建独立房间，消息回放和 RPC 夹具只绑定该房间，结束或断言失败均解散。
测试账号建房余额不足时，沿用现有 `TESTING_API_TOKEN` 补充机制。

## 采样方式

- `timeline.ts` 用 Playwright 时钟推进 JS 动画，用 Web Animations API 定位 CSS 动画时间。
  CSS 动画挂载时立即暂停，避免较慢机器在开始采样前已经播完淡入。
  保留 `animations: allow`，检查未启用 `__VISUAL_REGRESSION__` 或禁动画样式。
- 常规面板采样 0、80、160、320、640、1200ms。BottomSheet 下一帧挂载，入场文件名记录
  实际起点偏移 16ms。长动画另有明确的时间点，不根据当前实现时长自动缩放。
- 面板先真实打开、关闭以预热图片，再截入场和退场，最后重开验证遮罩释放。
  牌桌定时动画的准备阶段可快进，正式关键帧始终逐帧推进；弹簧抽屉的准备也逐帧推进。
  采样读取位置、透明度、变换；要求主体发生运动，避免把背景变化误当成面板动画。
- 固定画幅不跟随目标移动，位置错误不会因动态裁切被抵消。像素差比例上限 0.1%，
  颜色阈值 0.1。每个虚拟时刻等待连续两张截图一致，再比较基准，避免截到布局尚未提交的画面。
  原有游客搜索四帧用例和透明度断言继续保留。
- 表情、道具落点及火焰使用浏览器解码的 WebP，内部时间不受 JS 时钟控制。
  `imageFrames.ts` 比较实际页面加载素材的每一帧、尺寸、时间戳和帧时长；素材帧逐像素比较。
  原始素材帧只在手机项目比较一次，道具飞行在两种视口分别使用真实牌桌截图验证。
  全压时间线遮罩 WebP 区域，其内部图像由素材用例负责。
  这部分不声称验证浏览器实时解码播放的调度精度。
- 夹具固定匹配与老虎机响应，避免进入真实匹配队列或实际抽奖；只固定业务数据和必要的随机输入，
  不调用应用内部状态、组件方法，不向业务源码增加测试分支。
  拼三张结算使用固定随机种子，各金币仍保留不同轨迹；加注气泡在图片加载完成后采样。
  加载动画暂缓的单个 XHR 请求另设 120 秒真实网络超时：XHR 不受 JS 时钟控制，
  不能让慢机器的截图耗时触发业务超时。动画采样仍为 0–1600ms，结束后恢复请求行为。

已完成的 CSS 动画使用 `finish()` 归还控制，不能 `play()` 重启退场动画。
部分抽屉关闭后保留 DOM；测试检查透明度或视口外位置，并再次真实点击入口。

## CI 与报告

`H5 动画视觉回归` 支持 PR、master 更新、手动和部署后触发，三组独立运行，比较三遍，零重试。
HTML 报告位于 `visual/playwright-report/animations/<suite>/`，失败图片和时间线附件位于
`visual/test-results/animations/<suite>/`，CI 保存 14 天。
每个新增用例附带实际加载的构建版本；设置 `CLRN_EXPECTED_APPLICATION_COMMIT` 时会在采样前核对版本。
手动运行工作流可启用 `update_snapshots`，在 CI 生成候选图后连续比较三次。
也可用 `suite` 只验证发生变化的套件；候选图在比较前单独上传，便于提前检查。
候选图只上传 artifact，下载检查后再纳入仓库；普通 PR、部署和手动比较不会自动更新基准。

关键帧比较用于检测外观、进度和终态变化，不衡量真实设备帧率。
