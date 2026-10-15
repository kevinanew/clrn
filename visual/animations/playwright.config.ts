import { defineConfig } from '@playwright/test';
import path from 'node:path';
import visualConfig from '../playwright.config';

export default defineConfig({
  ...visualConfig,
  testDir: '.',
  testMatch: 'search-prompt.spec.ts',
  testIgnore: [],
  outputDir: '../test-results/animations',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
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
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    ...visualConfig.use,
    viewport: { width: 375, height: 812 },
    contextOptions: { reducedMotion: 'no-preference' },
    screenshot: 'only-on-failure',
  },
});
