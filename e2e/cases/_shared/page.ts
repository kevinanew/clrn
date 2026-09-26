import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export async function unique(page: Page, testId: string): Promise<Locator> {
  // React Navigation 保留隐藏的历史页面，仅在当前可见页面内检查唯一性。
  const target = page.getByTestId(testId).filter({ visible: true });
  await expect(target, `${testId} 应唯一`).toHaveCount(1);
  return target;
}

export async function prepareContext(context: BrowserContext, deviceId = randomUUID()): Promise<void> {
  await context.addInitScript((device) => {
    localStorage.setItem('app.language.code.key', 'zh-Hans');
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

export async function openLoginForm(page: Page): Promise<void> {
  await (await unique(page, 'hall-sign-in-button')).click();
  await (await unique(page, 'username-or-email-sign-in-button')).click();
  await expect(await unique(page, 'username-input')).toBeVisible();
  await expect(await unique(page, 'password-input')).toBeVisible();
}
