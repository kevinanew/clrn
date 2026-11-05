/** 固定构建的 5xx 定向复现，不在产品修复前并入默认回归套件。 */
import { defineConfig, devices } from '@playwright/test';
import { environment } from '../../helpers/environment';
import path from 'node:path';

const output = path.resolve(__dirname, '../../test-results/api-5xx', process.env.CLRN_5XX_RUN_ID || 'manual');

export default defineConfig({
  testDir: '.', testMatch: '*.scenario.ts', workers: 1, retries: 0,
  timeout: 150_000, expect: { timeout: 15_000 },
  outputDir: path.join(output, 'browser'),
  reporter: [['list'], ['json', { outputFile: path.join(output, 'results.json') }]],
  use: {
    ...devices['Desktop Chrome'], baseURL: environment.stagingUrl,
    trace: 'off', screenshot: 'off', video: 'off',
    actionTimeout: 15_000, navigationTimeout: 45_000,
  },
});
