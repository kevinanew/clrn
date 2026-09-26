import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

test('SETTINGS-006：我的战绩加载为空态并返回个人设置', async ({ page, signedInAccount }) => {
  await test.step('登录并从我的进入战绩', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
    await expect(await unique(page, 'game-record')).toHaveText('我的战绩');
    await (await unique(page, 'game-record')).click();
  });
  await test.step('等待接口完成并确认无战绩', async () => {
    await expect(await unique(page, 'no-records-text')).toHaveText('还没有战绩，您可以下拉重新获取');
    await expect(page.getByTestId('progress-hud-activity-indicator')).not.toBeVisible();
  });
  await test.step('通过导航返回我的', async () => {
    await goBack(page);
    await expect(await unique(page, 'game-record')).toHaveText('我的战绩');
  });
});
