import { expect, test } from '../_shared/account-fixture';
import { accountStatus } from '../_shared/auth';
import { openHall, unique } from '../_shared/page';
import { readDiamondBalance } from '../_shared/provision';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

test.use({ screenshot: 'off', trace: 'off' });

test('AUTH-007：测试接口创建独立账号后登录且不发放奖励', { tag: '@creates-data' }, async ({ page, newAccount }) => {
  const account = newAccount;
  await page.addLocatorHandler(page.getByTestId('add-to-home-open-button'), async () => {
    await (await unique(page, 'add-to-home-close-button')).click();
  });
  let extraRegistrations = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/public/v11/user/register/username_password') {
      extraRegistrations += 1;
    }
  });
  await test.step('通过测试接口创建本轮独立账号并从界面登录', async () => {
    expect(await accountStatus(page, account)).toBe(200);
  });
  await test.step('测试账号初始钻石为零，页面显示同一余额', async () => {
    expect(account.initialDiamondBalance, '测试注册不应发放钻石').toBe(0);
    await clickAfterSignInNotices(page, 'settings-tab');
    await expect(await unique(page, 'username-text')).toContainText(account.username);
    const balance = await unique(page, 'diamond-balance-text');
    await expect(balance).toHaveText(String(account.diamondBalance));
  });
  await test.step('刷新保留同一账号，不重复注册或重复发放钻石', async () => {
    await openHall(page);
    await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
    const sameUser = await page.evaluate(userId => {
      const raw = localStorage.getItem('save.user.origin.data.from.server.key');
      return raw !== null && String(JSON.parse(raw).user_id) === userId;
    }, account.userId);
    expect(sameUser, '刷新后应仍是本轮新账号').toBe(true);
    expect(await accountStatus(page, account), '刷新后原会话仍有效').toBe(200);
    await clickAfterSignInNotices(page, 'settings-tab');
    await expect(await unique(page, 'username-text')).toContainText(account.username);
    await expect(await unique(page, 'diamond-balance-text')).toHaveText(String(account.diamondBalance));
    expect(await readDiamondBalance(page, account), '只读浏览和刷新不改变钻石余额').toBe(account.diamondBalance);
    expect(extraRegistrations, '注册后的浏览与刷新不应再次请求注册').toBe(0);
  });
});
