import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// 独立取证不替代原动画比较；没有基准更新入口，两个时钟各自保留原硬断言及失败退出。
export default defineConfig({
  ...config,
  testMatch: 'cardSpriteControl.spec.ts',
  testIgnore: [],
  outputDir: '../test-results/card-sprite-control',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report/card-sprite-control' }]],
  updateSnapshots: 'none',
});
