/** E2E 使用自己的 Playwright 安装，所有应用用例共用持续日志 fixture。 */
import { test as base } from '@playwright/test';
import { diagnosticTest } from './diagnostic-fixture';
export * from '@playwright/test';
export const test = diagnosticTest(base);
