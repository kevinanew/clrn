import { test as base, expect } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus, signIn, type Session } from './auth';
import { openHall, prepareContext, unique } from './page';
import { readDiamondBalance } from './provision';

export type SignedInAccount = Session & { username: string; diamondBalance: number };

export const test = base.extend<{
  signedInAccount: SignedInAccount;
  /** 兼容旧只读案例；新案例使用 signedInAccount，避免暗示注册新账号。 */
  newAccount: SignedInAccount;
}>({
  signedInAccount: async ({ page, context }, use) => {
    let account: SignedInAccount;
    try {
      // 每个测试独立设备和浏览器上下文；不跨认证回归缓存旧会话。
      await prepareContext(context);
      await openHall(page);
      expect(new URL(page.url()).origin, '只读账号只能登录配置的 staging').toBe(new URL(environment.stagingUrl).origin);
      // signIn 阻断自动注册接口；账号不存在时失败，绝不注册。
      const session = await signIn(page);
      expect(await accountStatus(page, session), '已有测试账号会话应有效').toBe(200);
      account = {
        ...session,
        username: environment.testUsername,
        diamondBalance: await readDiamondBalance(page, session),
      };
    } catch {
      // 避免 setup 失败时保存密码表单 DOM 或带 Authorization 的请求错误。
      await page.close().catch(() => undefined);
      throw new Error('已有 staging 只读账号登录或会话/钱包检查失败；未注册新账号');
    }
    const message = page.getByTestId('alert-message-text').filter({ visible: true });
    // 此后台错误可能晚于登录返回；只允许用户确认一次，其他内容明确失败。
    // locator handler 在操作受遮挡时执行，网络 alert 也会先于隐私“同意”处理。
    await page.addLocatorHandler(message, async () => {
      await expect(message).toHaveCount(1);
      await expect(message).toHaveText(/^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/);
      const confirm = await unique(page, 'alert-custom-button');
      await expect(confirm).toHaveText('好的');
      base.info().annotations.push({
        type: 'staging-background-error',
        description: '后台 v10/club 列表请求出现网络提示；用户确认一次后继续只读浏览。',
      });
      await confirm.click();
    }, { times: 1 });
    const privacy = page.getByTestId('privacy-popup-modal').filter({ visible: true });
    if (await privacy.count()) {
      await expect(await unique(page, 'privacy-popup-title')).toHaveText('用户隐私策略概要');
      await (await unique(page, 'privacy-popup-agree')).click();
      await expect(privacy).not.toBeVisible();
    }
    await (await unique(page, 'hall-search-button')).click({ trial: true });
    await use(account);
  },
  newAccount: async ({ signedInAccount }, use) => {
    await use(signedInAccount);
  },
});

export { expect };
