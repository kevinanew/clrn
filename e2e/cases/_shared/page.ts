import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * 查找当前页面内唯一可见的测试元素，排除导航历史中的隐藏页面。
 * @param page - 执行操作的 Playwright 页面。
 * @param testId - 目标元素的测试标记。
 */
export async function unique(page: Page, testId: string): Promise<Locator> {
  // React Navigation 保留隐藏的历史页面，仅在当前可见页面内检查唯一性。
  const target = page.getByTestId(testId).filter({ visible: true });
  await expect(target, `${testId} 应唯一`).toHaveCount(1);
  return target;
}

/**
 * 在首次导航前设置设备标识和引导完成标记，保留用户已选择的语言。
 * @param context - 首次导航前配置的浏览器上下文。
 * @param deviceId - 本轮浏览器使用的设备标识。
 */
export async function prepareContext(context: BrowserContext, deviceId = randomUUID()): Promise<void> {
  await context.addInitScript((device) => {
    // 仅初始化新上下文；刷新时不能覆盖用户刚选择的语言，否则会掩盖持久化回归。
    if (!localStorage.getItem('app.language.code.key')) {
      localStorage.setItem('app.language.code.key', 'zh-Hans');
    }
    localStorage.setItem('deviceId', device);
    for (const key of [
      'hall.screen.tutorial.complete.key',
      'personal.house.screen.tutorial.complete.key',
      'create.room.screen.tutorial.complete.key',
    ]) {
      localStorage.setItem(key, 'true');
    }
  }, deviceId);
}

/**
 * 打开部署站点，处理 staging 提示并等待大厅就绪。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function openHall(page: Page): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), '线上入口应返回成功状态').toBeTruthy();
  // staging 首次访问必须确认提示后才挂载大厅。
  const ready = page.getByTestId('hall-screen').or(page.getByTestId('confirm-button'));
  await expect(ready.first()).toBeVisible({ timeout: 60_000 });
  if (await page.getByTestId('confirm-button').isVisible()) {
    await (await unique(page, 'confirm-button')).click();
  }
  await expect(await unique(page, 'hall-screen')).toBeVisible({ timeout: 60_000 });
}

/**
 * 从大厅进入用户名登录表单，等待输入框可见。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function openLoginForm(page: Page): Promise<void> {
  await (await unique(page, 'hall-sign-in-button')).click();
  await (await unique(page, 'username-or-email-sign-in-button')).click();
  await expect(await unique(page, 'username-input')).toBeVisible();
  await expect(await unique(page, 'password-input')).toBeVisible();
}
