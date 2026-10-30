import { MAXIMUM_DIFFERENT_PIXEL_RATIO } from '../screenshotComparisonConfiguration';
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import visualConfig from '../playwright.config';

const independentControls = ['**/cardSpriteControl.spec.ts'];

export default defineConfig({
  ...visualConfig,
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: independentControls,
  outputDir: '../test-results/animations',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  projects: [
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
    // 项目级 testIgnore 会覆盖全局值，必须同时保留独立对照与旧搜索的排除。
    { name: 'desktop', testIgnore: [...independentControls, '**/search-prompt.spec.ts'], use: { viewport: { width: 1440, height: 900 } } },
  ],
  // 缺失基准也必须失败；只有显式传入 --update-snapshots 才生成候选图。
  updateSnapshots: 'none',
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.resolve(__dirname, '../playwright-report/animations') }]],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'allow',
      caret: 'hide',
      scale: 'css',
      threshold: 0.1,
      maxDiffPixelRatio: MAXIMUM_DIFFERENT_PIXEL_RATIO,
    },
  },
  use: {
    ...visualConfig.use,
    locale: 'en-US',
    launchOptions: { ...visualConfig.use?.launchOptions,
      args: [...(visualConfig.use?.launchOptions?.args || []), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    viewport: { width: 375, height: 812 },
    contextOptions: { reducedMotion: 'no-preference' },
    screenshot: 'only-on-failure',
  },
});
