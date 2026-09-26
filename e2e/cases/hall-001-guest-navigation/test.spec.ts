import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

test('HALL-001：游客进入私人房间后返回大厅', async ({ page, context }) => {
  await test.step('准备简体中文游客大厅', async () => {
    await prepareContext(context);
    await openHall(page);
    await expect(await unique(page, 'hall-auth-state-signed-out')).toBeVisible();
  });
  await test.step('进入私人房间并检查游客空态', async () => {
    await (await unique(page, 'private-room-tab')).click();
    await expect(await unique(page, 'guest-private-room-empty-state')).toBeVisible();
  });
  await test.step('返回大厅，仍可使用登录入口', async () => {
    await (await unique(page, 'hall-tab')).click();
    await expect(await unique(page, 'hall-screen')).toBeVisible();
    await expect(await unique(page, 'hall-sign-in-button')).toBeVisible();
  });
});
