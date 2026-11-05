import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

test('AUTH-009：登录语言选择确认后保存，刷新仍显示对应语言', /** 验证AUTH-009：登录语言选择确认后保存，刷新仍显示对应语言。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, context }) => {
  // 移动端重复访问会出现添加到桌面提示，按真实关闭按钮处理遮挡。
  await page.addLocatorHandler(page.getByTestId('add-to-home-open-button'), /** 关闭添加到主屏提示并确认遮挡已消失。 */ async () => {
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
    await test.step(`切换 ${locale.label}，检查保存和刷新后的界面`, /** 执行切换 $\{locale.label\}，检查保存和刷新后的界面。 */ async () => {
      await (await unique(page, 'hall-sign-in-button')).click();
      await (await unique(page, 'switch-language-button')).click();
      const option = await unique(page, locale.id);
      await option.click();
      await expect(option.getByTestId('checkmark-icon')).toHaveCount(1);
      await (await unique(page, 'confirm-button')).click();
      await expect.poll(/** 重复读取`page.evaluate(() => localStorage.getItem('app.language.code.key'))`，直到满足外层等待断言。 */ () => page.evaluate(/** 在页面中读取`localStorage.getItem('app.language.code.key')`，供测试判断当前界面状态。 */ () => localStorage.getItem('app.language.code.key'))).toBe(locale.code);
      await openHall(page);
      await (await unique(page, 'hall-sign-in-button')).click();
      await expect(await unique(page, 'switch-language-label')).toHaveText(locale.label);
      await expect(await unique(page, 'greeting-text')).toHaveText(locale.greeting);
      await (await unique(page, 'close-user-authentication-button')).click();
    });
  }
});
