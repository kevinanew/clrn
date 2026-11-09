import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// 独立取证不替代原动画比较；没有基准更新入口，两个时钟各自保留原硬断言及失败退出。
export default defineConfig({
  ...config,
  testMatch: 'cardSpriteControl.spec.ts',
  testIgnore: [],
  // 普通桌面项目也排除了对照文件；独立入口必须显式清除项目级排除。
  projects: config.projects?.map(/** 清空项目的测试忽略列表，使独立时钟控制用例可被发现。
 * @param project - 当前操作使用的 project。 */ project => ({ ...project, testIgnore: [] })),
  outputDir: '../test-results/card-sprite-control',
  reporter: [['../../e2e/helpers/diagnostic-reporter.ts'], ['list'], ['html', { open: 'never', outputFolder: '../playwright-report/card-sprite-control' }]],
  updateSnapshots: 'none',
});
