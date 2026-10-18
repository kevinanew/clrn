/** H5 构建与正式站冒烟配置；CI 的 Release 服务器由外层测试命令统一管理。 */
import { defineConfig, devices } from '@playwright/test';
import { runtime } from './helpers/environment';

/**
 * H5 站点可用性冒烟测试（访问本轮 Release 或指定的 staging / production）。
 * 登录态和多个 Playwright 命令共用外层包装器启动的服务器。
 */
export default defineConfig({
  testDir: './',
  testMatch: /.*\.spec\.ts/,
  testIgnore: ['**/cases/**', '**/interactions/**', '**/.venv/**'],
  outputDir: './test-results',
  fullyParallel: true,
  workers: runtime.workers,
  retries: runtime.retries,
  // 覆盖最多三次导航（135s）、首屏各阶段检查（最多 55s）及版本元信息读取，
  // 同时以 240s 限制单个站点用例的总耗时。
  timeout: 240_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // 真实 CI 账号的登录请求包含私有密码，不能将网络 trace 写入报告。
    trace: 'off',
    launchOptions: {
      args: [
        // CI 容器里以 root 运行，且默认 /dev/shm 只有 64M，
        // 渲染 H5 首屏时 Chromium 会随机崩溃（#6045 的 Page crashed）。
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  },
});
