import { test, expect } from '../_shared/read-account-fixture';
import { openHall, unique } from '../_shared/page';
import { openSettingsItem } from '../_shared/navigation';

test('AUTH-010：退出可取消，确认后刷新仍为游客且受保护入口要求登录', async ({ page, signedInAccount }) => {
  await page.addLocatorHandler(page.getByTestId('add-to-home-open-button'), async () => {
    await (await unique(page, 'add-to-home-close-button')).click();
  });
  expect(signedInAccount.userId).toBeTruthy();
  await (await unique(page, 'settings-tab')).click();
  // 动作面板与救济金提示可能同时显示，按钮只能在退出面板内定位。
  const signOutDialog = page.getByRole('dialog').filter({
    has: page.getByText('退出登录', { exact: true }),
  }).filter({ visible: true });
  await test.step('取消退出保留当前账号', async () => {
    await openSettingsItem(page, 'sign-out');
    await expect(signOutDialog).toHaveCount(1);
    const cancel = signOutDialog.getByText('取消', { exact: true });
    await expect(cancel).toHaveCount(1);
    await test.info().attach('退出登录确认弹窗', { body: await page.screenshot(), contentType: 'image/png' });
    await cancel.click();
    await expect(signOutDialog).not.toBeVisible();
    await expect(await unique(page, 'username-text')).toContainText(signedInAccount.username);
  });
  await test.step('确认退出后资产和账号入口恢复游客状态', async () => {
    await openSettingsItem(page, 'sign-out');
    await expect(signOutDialog).toHaveCount(1);
    const confirm = signOutDialog.getByText('退出登录', { exact: true });
    await expect(confirm).toHaveCount(1);
    await confirm.click();
    await expect(signOutDialog).not.toBeVisible();
    await expect(await unique(page, 'after-sign-in-see-asset-text')).toHaveText('登录后可查看钻石金币余额');
    await expect(page.getByTestId('username-text').filter({ visible: true })).toHaveCount(0);
  });
  await test.step('重新加载后不会自动恢复登录，私人房间入口仍受保护', async () => {
    await openHall(page);
    await expect(await unique(page, 'hall-sign-in-button')).toBeVisible();
    await expect(page.getByTestId('hall-auth-state-signed-in')).toHaveCount(0);
    await (await unique(page, 'personal-house-create')).click();
    await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
  });
});
