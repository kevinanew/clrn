import { defineConfig, devices } from '@playwright/test';
import { environment } from '../helpers/environment';

export default defineConfig({
  testDir: '.',
  globalSetup: './_shared/account-run-setup.ts',
  testMatch: '**/test.spec.ts',
  // 共用测试账号的场景不能并发签发登录凭据；桌面和手机也顺序执行。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../test-results/cases',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report/cases' }]],
  use: {
    baseURL: environment.stagingUrl,
    locale: 'zh-CN',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // 登录请求包含凭据，不将网络 trace 保存到 CI 产物中。
    trace: 'off',
    screenshot: 'only-on-failure',
    channel: 'chromium',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
