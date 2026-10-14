import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/../snapshots/android-35-720x1280-en/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  // 缺少基准属于失败，只有显式 reference 命令才能创建或替换基准。
  updateSnapshots: 'none',
  expect: { toMatchSnapshot: { threshold: 0.1, maxDiffPixels: 0 } },
  reporter: [['list'], ['html', { outputFolder: 'android/playwright-report', open: 'never' }]],
});
