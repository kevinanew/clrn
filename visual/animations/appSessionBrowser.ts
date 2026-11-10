/** 离线动画回归共用的浏览器启动与受控读取失败夹具。 */
import { chromium } from '@playwright/test';

/** 按现有诊断浏览器配置启动 Chromium，缺省使用固定 Playwright 浏览器。 */
export function launchAnimationBrowser() {
  return chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
}

/**
 * 恢复可选环境变量，避免后续加载器场景读取到本轮临时目录。
 * @param name - 环境变量名。
 * @param value - 测试前的原始值。
 */
export function restoreAnimationEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
