import { randomBytes } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus, signIn, type Session } from './auth';
import { openHall, prepareContext } from './page';
import { createTestingAccount } from './test-user';
import { readTestApiToken } from './test-wallet';
import { clickAfterSignInNotices } from './sign-in-notices';

export type SecondAccount = Session & { page: Page; context: BrowserContext; username: string };

/** 只为多用户业务案例创建独立 staging 账号；注册凭据不写入报告。 */
export async function createSecondAccount(browser: Browser, viewport: { width: number; height: number } | null,
  mobile: boolean): Promise<SecondAccount> {
  const token = await readTestApiToken();
  const username = `e2e${randomBytes(7).toString('hex')}`;
  const password = `T${randomBytes(7).toString('hex')}9`;
  const context = await browser.newContext({
    viewport: viewport || { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile, locale: 'zh-CN',
    baseURL: environment.stagingUrl,
  });
  const page = await context.newPage();
  try {
    await prepareContext(context);
    const created = await createTestingAccount({ username, password }, token);
    await openHall(page);
    const session = await signIn(page, { username, password });
    expect(session.userId, '第二账号必须是刚创建的用户').toBe(created.userId);
    expect(await accountStatus(page, session)).toBe(200);
    await clickAfterSignInNotices(page, 'hall-tab');
    return { ...session, page, context, username };
  } catch {
    await context.close();
    throw new Error('多用户 staging 测试账号准备失败；不会重试注册');
  }
}
