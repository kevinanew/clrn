/** 视觉与动画使用自己的 Playwright 安装，复用持续日志 fixture。 */
import { test as base } from '@playwright/test';
import { diagnosticTest } from '../../../e2e/helpers/diagnostic-fixture';
export * from '@playwright/test';
export const test = diagnosticTest(base);
