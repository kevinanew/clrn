import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

test('AUTH-009：登录语言选择确认后保存，刷新仍显示对应语言', async ({ page, context }) => {
  // 移动端重复访问会出现添加到桌面提示，按真实关闭按钮处理遮挡。
  await page.addLocatorHandler(page.getByTestId('add-to-home-open-button'), async () => {
    await (await unique(page, 'add-to-home-close-button')).click();
    await expect(page.getByTestId('add-to-home-open-button')).not.toBeVisible();
  });
  await prepareContext(context);
  await openHall(page);
  for (const locale of [
    { id: 'english', code: 'en', label: 'English', greeting: 'Welcome to GoPlay360' },
    { id: 'zh-hant', code: 'zh-Hant', label: '繁體中文', greeting: '歡迎來到來玩' },
    { id: 'zh-hans', code: 'zh-Hans', label: '简体中文', greeting: '欢迎来到来玩' },
  ]) {
    await test.step(`切换 ${locale.label}，检查保存和刷新后的界面`, async () => {
      await (await unique(page, 'hall-sign-in-button')).click();
      await (await unique(page, 'switch-language-button')).click();
      const option = await unique(page, locale.id);
      await option.click();
      await expect(option.getByTestId('checkmark-icon')).toHaveCount(1);
      await (await unique(page, 'confirm-button')).click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('app.language.code.key'))).toBe(locale.code);
      await openHall(page);
      await (await unique(page, 'hall-sign-in-button')).click();
      await expect(await unique(page, 'switch-language-label')).toHaveText(locale.label);
      await expect(await unique(page, 'greeting-text')).toHaveText(locale.greeting);
      await (await unique(page, 'close-user-authentication-button')).click();
    });
  }
});
