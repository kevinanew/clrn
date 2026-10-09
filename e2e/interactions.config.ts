import { defineConfig, devices } from '@playwright/test';
import { environment } from './helpers/environment';

export default defineConfig({
  testDir: './interactions',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: './test-results/interactions',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL: process.env.E2E_INTERACTION_BASE_URL || environment.stagingUrl,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    launchOptions: {
      // CI 容器使用 root 且共享内存较小，保持与站点冒烟配置一致。
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'touch', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
});
