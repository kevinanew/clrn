import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: (process.env.ANDROID_LOCALE || 'en') === 'en' && ['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    ? ['**/*.spec.ts'] : ['**/parity.spec.ts'],
  outputDir: './test-results',
  snapshotPathTemplate: process.env.GITHUB_ACTIONS === 'true'
    ? `{testDir}/../snapshots/android-35-x86_64-720x1280-${process.env.ANDROID_LOCALE || 'en'}/{arg}{ext}`
    : '{testDir}/../snapshots/local/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 连续故障时停止当前业务组；失败和未执行场景仍使 CI 失败。
  maxFailures: 3,
  timeout: 180_000,
  // 缺少基准属于失败，只有显式 reference 命令才能创建或替换基准。
  updateSnapshots: 'none',
  expect: { toMatchSnapshot: { threshold: 0.1, maxDiffPixels: 0 } },
  reporter: [['list'], ['html', { outputFolder: path.join(__dirname, 'playwright-report'), open: 'never' }]],
});
