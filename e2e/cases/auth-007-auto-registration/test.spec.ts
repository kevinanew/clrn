import { expect, test } from '../_shared/account-fixture';
import { accountStatus } from '../_shared/auth';
import { unique } from '../_shared/page';

test.use({ screenshot: 'off', trace: 'off' });

test('AUTH-007：独立新账号自动注册登录并获得测试钻石', async ({ page, newAccount }) => {
  const account = newAccount;
  await test.step('通过真实注册界面创建本轮独立账号', async () => {
    expect(await accountStatus(page, account)).toBe(200);
  });
  await test.step('注册奖励提供非零钻石，页面显示同一余额', async () => {
    expect(account.registrationDiamondBalance, '注册时应获得创建功能可用的钻石').toBeGreaterThan(0);
    await (await unique(page, 'settings-tab')).click();
    const balance = await unique(page, 'diamond-balance-text');
    await expect(balance).toHaveText(String(account.diamondBalance));
  });
});
