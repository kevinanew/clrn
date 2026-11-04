/** 修复前定向复现入口；独立于主干套件运行，禁止自动重试掩盖资金异常。 */
import { defineConfig, devices } from '@playwright/test';
import { environment } from '../../helpers/environment';
import path from 'node:path';

const runDirectory = path.resolve(__dirname, '../../test-results/issue-94', process.env.ISSUE94_RUN_ID || 'manual');

export default defineConfig({
  testDir: '.',
  testMatch: process.env.ISSUE94_PEER_USERNAME ? 'coin-table.scenario.ts' : /(?:private-table|http-buy-in)\.scenario\.ts/,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: path.join(runDirectory, 'browser'),
  reporter: [['list'], ['json', { outputFile: path.join(runDirectory, 'results.json') }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: environment.stagingUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
});
