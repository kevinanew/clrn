import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:8080';
// 与 laiwan_io_web 的视觉回归保持一致：允许整张截图最多 0.3% 的像素差异。
const MAX_DIFF_PIXEL_RATIO = 0.003;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // 基准图提交到 Git：snapshots/{场景 label}.png（仅在 Docker/Linux 生成，无平台后缀）
  snapshotPathTemplate: '{testDir}/../snapshots/{arg}{ext}',
  fullyParallel: true,
  workers: Number(process.env.VISUAL_WORKERS || 2),
  // 截图类偶发失败（staging 波动）自动重试一次
  retries: Number(process.env.VISUAL_RETRIES ?? 1),
  // 单场景上限：staging 慢时登录/加载等待较长
  timeout: 300000,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    deviceScaleFactor: 1,
    // 必须设置：Playwright 动作默认不限时，卡住的动作（如对「误判不可见」
    // 元素的 scrollIntoViewIfNeeded）会一直挂到整个测试超时
    actionTimeout: 15000,
    // 失败时保留 trace，playwright show-report 里可逐步回放排查
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        // Docker 默认 /dev/shm 只有 64M，Chromium 渲染大页面会随机崩溃
        '--disable-dev-shm-usage',
        // 固定软件栅格化与字体抗锯齿，避免同一 Docker 环境内出现少量像素漂移
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--disable-skia-runtime-opts',
        '--num-raster-threads=1',
        '--run-all-compositor-stages-before-draw',
        '--disable-new-content-rendering-timeout',
        '--disable-threaded-animation',
        '--disable-threaded-scrolling',
        '--disable-checker-imaging',
        '--disable-image-animation-resync',
        '--disable-partial-raster',
        '--disable-features=PaintHolding',
        '--disable-lcd-text',
        '--disable-font-subpixel-positioning',
        '--font-render-hinting=none',
        '--force-color-profile=srgb',
        // 避免 Linux Docker 默认 locale 变成 en-US@posix
        '--lang=en-US',
      ],
    },
  },
});
