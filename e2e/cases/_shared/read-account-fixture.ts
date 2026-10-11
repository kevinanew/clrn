import { test as base, expect } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus, signIn, type Session } from './auth';
import { openHall, prepareContext, unique } from './page';
import { readDiamondBalance } from './provision';
import { installSignInNoticeHandler } from './sign-in-notices';

export type SignedInAccount = Session & { username: string; diamondBalance: number };

export const test = base.extend<{
  signedInAccount: SignedInAccount;
  /** 兼容旧只读案例；新案例使用 signedInAccount，避免暗示注册新账号。 */
  newAccount: SignedInAccount;
}>({
  /**
   * 登录既有只读测试账号并校验会话与钱包，禁止注册缺失账号。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
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
    // 提示可能晚于登录返回；在后续操作前取消救济金，不改变账号资产。
    await installSignInNoticeHandler(page);
    await (await unique(page, 'hall-search-button')).click({ trial: true });
    await use(account);
  },
  /**
   * 提供本轮创建或恢复的测试账号，交给案例执行并验证会话归属。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  newAccount: async ({ signedInAccount }, use) => {
    await use(signedInAccount);
  },
});

export { expect };
