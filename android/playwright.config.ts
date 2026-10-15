import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  testIgnore: (process.env.ANDROID_LOCALE || 'en') === 'en' && ['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    ? [] : ['**/auth.spec.ts'],
  outputDir: './test-results',
  snapshotPathTemplate: process.env.GITHUB_ACTIONS === 'true'
    ? `{testDir}/../snapshots/android-35-x86_64-720x1280-${process.env.ANDROID_LOCALE || 'en'}/{arg}{ext}`
    : '{testDir}/../snapshots/local/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 基准采集遍历全部独立场景以报告覆盖缺口；正式比较连续故障时停止当前业务组。
  // 两种模式中的任何失败都会使 CI 失败，房间仍由每个场景的 finally 清理。
  maxFailures: process.env.ANDROID_VISUAL_MODE === 'reference' ? 0 : 3,
  timeout: 180_000,
  // 缺少基准属于失败，只有显式 reference 命令才能创建或替换基准。
  updateSnapshots: 'none',
  expect: { toMatchSnapshot: { threshold: 0.1, maxDiffPixels: 0 } },
  reporter: [['list'], ['html', { outputFolder: path.join(__dirname, 'playwright-report'), open: 'never' }]],
});
