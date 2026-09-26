import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

for (const entry of ['slot-banner', 'daily-bonus-button', 'store-button', 'personal-house-create', 'personal-house-join']) {
  test(`HALL-004：游客 ${entry} 登录引导关闭后可返回大厅`, async ({ page, context }) => {
    await prepareContext(context);
    await openHall(page);
    await test.step('进入受保护业务并检查登录入口', async () => {
      await (await unique(page, entry)).click();
      await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
      await expect(page.getByTestId('hall-auth-state-signed-in')).toHaveCount(0);
    });
    await test.step('关闭登录后保持游客状态，入口可再次使用', async () => {
      await (await unique(page, 'close-user-authentication-button')).click();
      await expect(page.getByTestId('username-or-email-sign-in-button').filter({ visible: true })).toHaveCount(0);
      await expect(await unique(page, 'hall-sign-in-button')).toBeVisible();
      await (await unique(page, entry)).click();
      await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
    });
  });
}
