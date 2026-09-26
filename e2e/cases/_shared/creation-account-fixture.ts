import { readFile } from 'node:fs/promises';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus, signIn, type Session } from './auth';
import { openHall, prepareContext } from './page';
import { readDiamondBalance } from './provision';
import { clickAfterSignInNotices } from './sign-in-notices';

type CreationAccount = Session & { username: string; diamondBalance: number };

/** 创建专用账号由环境提供；本仓库不执行任何补钻操作。 */
export const test = base.extend<{ newAccount: CreationAccount }>({
  newAccount: async ({ page, context }, use) => {
    let account: CreationAccount;
    try {
      await prepareContext(context);
      const stateFile = process.env.E2E_CREATION_STORAGE_STATE_FILE;
      let session: Session;
      let username: string;
      if (stateFile) {
        const state = JSON.parse(await readFile(stateFile, 'utf8')) as Awaited<ReturnType<BrowserContext['storageState']>>;
        const origin = new URL(environment.stagingUrl).origin;
        const local = state.origins.find(entry => entry.origin === origin);
        if (!local) throw new Error('缺少 staging 创建账号状态');
        const raw = local.localStorage.find(entry => entry.name === 'save.user.origin.data.from.server.key');
        const auth = raw ? JSON.parse(raw.value) : null;
        if (!auth?.user_id || !auth?.username || !auth?.api_token?.access_token || !auth?.api_token?.token_type) {
          throw new Error('创建账号状态不完整');
        }
        username = auth.username;
        await context.addInitScript(({ origin, entries }) => {
          if (location.origin === origin) {
            for (const { name, value } of entries) localStorage.setItem(name, value);
          }
        }, { origin, entries: local.localStorage });
        const accountResponse = page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.protocol === 'https:' && url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com')
            && url.pathname === `/v11/user/${encodeURIComponent(auth.user_id)}/account`;
        }, { timeout: 60_000 });
        await openHall(page);
        const response = await accountResponse;
        session = {
          userId: String(auth.user_id), accountUrl: response.url(),
          authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}`,
        };
      } else {
        const configuredUsername = process.env.E2E_CREATION_USERNAME;
        const password = process.env.E2E_CREATION_PASSWORD;
        if (!configuredUsername || !password) throw new Error('缺少创建专用账号环境变量');
        username = configuredUsername;
        await openHall(page);
        session = await signIn(page, { username, password });
      }
      expect(await accountStatus(page, session)).toBe(200);
      await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible();
      account = { ...session, username, diamondBalance: await readDiamondBalance(page, session) };
      await clickAfterSignInNotices(page, 'hall-tab');
    } catch {
      await page.close().catch(() => undefined);
      throw new Error('创建专用账号准备失败；请检查环境凭据、staging 会话及余额前置条件');
    }
    await use(account);
  },
});

export { expect };
