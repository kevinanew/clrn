import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

for (const document of ['user-agreement', 'user-privacy']) {
  test(`AUTH-006：${document} 显示可阅读正文并返回登录`, async ({ page, context }) => {
    await test.step('从登录首页打开文档', async () => {
      await prepareContext(context);
      await openHall(page);
      await (await unique(page, 'hall-sign-in-button')).click();
      await (await unique(page, `${document}-button`)).click();
    });
    await test.step('确认内嵌文档加载了正文', async () => {
      const screen = await unique(page, `${document}-screen`);
      const frame = screen.locator('iframe');
      await expect(frame).toHaveCount(1);
      await expect(frame.contentFrame().locator('body')).toContainText('来玩');
      await expect(frame.contentFrame().locator('body')).toContainText('隐私');
    });
    await test.step('返回登录首页，仍可选择登录方式', async () => {
      await (await unique(page, 'back-button')).click();
      await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
      await expect(await unique(page, 'user-agreement-button')).toBeVisible();
      await expect(await unique(page, 'user-privacy-button')).toBeVisible();
    });
  });
}
