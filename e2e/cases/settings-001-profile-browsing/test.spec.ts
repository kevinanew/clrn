import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

test('SETTINGS-001：个人资料预填、取消编辑与等级浏览', async ({ page, signedInAccount }) => {
  await test.step('登录并检查我的资料和余额', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
    await expect(await unique(page, 'username-text')).toContainText(signedInAccount.username);
    for (const id of ['coin-balance-text', 'diamond-balance-text']) {
      await expect(await unique(page, id)).toHaveText(/^[\d,.]+$/);
    }
  });
  await (await unique(page, 'user-info-button')).click();
  await expect(await unique(page, 'content-text-1')).toHaveText(signedInAccount.username);
  const nickname = await (await unique(page, 'content-text-0')).innerText();
  await test.step('昵称预填当前资料，取消编辑后资料不变', async () => {
    await (await unique(page, 'profile-item-0')).click();
    await expect(await unique(page, 'nickname-input')).toHaveValue(nickname);
    await (await unique(page, 'nickname-input')).fill('E2E取消编辑');
    await (await unique(page, 'back-button')).click();
    await expect(await unique(page, 'content-text-0')).toHaveText(nickname);
  });
  await test.step('签名输入后取消，重新打开仍为原值', async () => {
    await (await unique(page, 'profile-item-3')).click();
    const original = await (await unique(page, 'bio-input')).inputValue();
    await (await unique(page, 'bio-input')).fill('E2E取消签名');
    await (await unique(page, 'back-button')).click();
    await expect(await unique(page, 'title-text-3')).toHaveText('个性签名');
    await (await unique(page, 'profile-item-3')).click();
    await expect(await unique(page, 'bio-input')).toHaveValue(original);
    await (await unique(page, 'back-button')).click();
  });
  await test.step('返回我的并浏览等级说明及奖励', async () => {
    await goBack(page);
    await expect(await unique(page, 'nickname-text')).toHaveText(nickname);
    await (await unique(page, 'user-level')).click();
    await expect(await unique(page, 'user-level-screen')).toContainText('使用金币进行游戏会提高等级');
    await expect(page.getByTestId('coin-amount').first()).toHaveText(/^\d+$/);
    await goBack(page);
    await expect(await unique(page, 'username-text')).toContainText(signedInAccount.username);
  });
});
