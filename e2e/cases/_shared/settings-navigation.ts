import { expect, type Page } from '@playwright/test';
import { openSettingsItem } from './navigation';
import { unique } from './page';
import { clickAfterSignInNotices } from './sign-in-notices';

/**
 * 共用真实设置入口及虚拟列表滚动，业务断言保留在各案例内。
 * @param page - 执行操作的 Playwright 页面。
 * @param item - 要打开的菜单或设置项标识。
 */
export async function openSettings(page: Page, item: string): Promise<void> {
  await clickAfterSignInNotices(page, 'settings-tab');
  await expect(await unique(page, 'settings-screen')).toBeVisible();
  await openSettingsItem(page, item);
}
