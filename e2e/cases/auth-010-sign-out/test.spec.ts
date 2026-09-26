import { test, expect } from '../_shared/read-account-fixture';
import { openHall, unique } from '../_shared/page';
import { openSettingsItem } from '../_shared/navigation';

test('AUTH-010：退出可取消，确认后刷新仍为游客且受保护入口要求登录', async ({ page, signedInAccount }) => {
  await page.addLocatorHandler(page.getByTestId('add-to-home-open-button'), async () => {
    await (await unique(page, 'add-to-home-close-button')).click();
  });
  expect(signedInAccount.userId).toBeTruthy();
  await (await unique(page, 'settings-tab')).click();
  await test.step('取消退出保留当前账号', async () => {
    await openSettingsItem(page, 'sign-out');
    const cancel = page.getByText('取消', { exact: true }).filter({ visible: true });
    await expect(cancel).toHaveCount(1);
    await test.info().attach('退出登录确认弹窗', { body: await page.screenshot(), contentType: 'image/png' });
    await cancel.click();
    await expect(await unique(page, 'username-text')).toContainText(signedInAccount.username);
  });
  await test.step('确认退出后资产和账号入口恢复游客状态', async () => {
    await openSettingsItem(page, 'sign-out');
    // 动作面板没有独立按钮 testid，排除背景设置列表里的同名项。
    const confirm = page.getByText('退出登录', { exact: true }).filter({ visible: true });
    await expect(confirm).toHaveCount(2);
    await confirm.last().click();
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
