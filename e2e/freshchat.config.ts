import { defineConfig } from '@playwright/test';
import { runtime } from './helpers/environment';
import interactions from './interactions.config';

export default defineConfig({
  ...interactions,
  testMatch: 'freshchat.spec.ts',
  // 覆盖有限导航重试、大厅启动和第三方 SDK 加载；各阶段保留自身超时。
  timeout: 360_000,
  // 第三方网络瞬态故障允许重试一次；持续故障仍必须令 CI 失败。
  retries: runtime.retries,
  outputDir: './test-results/freshchat',
  use: {
    ...interactions.use,
    launchOptions: {
      // CI 使用 root 和较小的共享内存，与站点冒烟保持一致。
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
});
