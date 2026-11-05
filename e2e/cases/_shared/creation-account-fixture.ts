import { readFile } from 'node:fs/promises';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { signIn, type Session } from './auth';
import { accountPreparationError, verifyAccountSession } from './account-diagnostics';
import { openHall, prepareContext } from './page';
import { readDiamondBalance } from './provision';
import { clickAfterSignInNotices } from './sign-in-notices';
import { readTestApiToken, setCreationDiamondBalance } from './test-wallet';

type CreationAccount = Session & { username: string; diamondBalance: number };

/** 每个创建案例从 60 钻开始，业务扣费和退款仍由真实接口验证。 */
export const test = base.extend<{ newAccount: CreationAccount }>({
  /**
   * 提供本轮创建或恢复的测试账号，交给案例执行并验证会话归属。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  newAccount: async ({ page, context }, use) => {
    const walletToken = await readTestApiToken();
    const stateFile = process.env.E2E_CREATION_STORAGE_STATE_FILE;
    const configuredUsername = process.env.E2E_CREATION_USERNAME;
    const password = process.env.E2E_CREATION_PASSWORD;
    if (!stateFile && (!configuredUsername || !password)) {
      throw new Error('缺少创建专用账号配置：请设置 E2E_CREATION_USERNAME 和 E2E_CREATION_PASSWORD，或 E2E_CREATION_STORAGE_STATE_FILE');
    }
    let session: Session;
    let username: string;
    let operation = 'creation-account-setup';
    try {
      await prepareContext(context);
      if (stateFile) {
        operation = 'creation-account-state';
        const state = JSON.parse(await readFile(stateFile, 'utf8')) as Awaited<ReturnType<BrowserContext['storageState']>>;
        const origin = new URL(environment.stagingUrl).origin;
        const local = state.origins.find(/** 查找满足以下条件的首个条目：`entry.origin === origin`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.origin === origin);
        if (!local) throw new Error('缺少 staging 创建账号状态');
        const raw = local.localStorage.find(/** 查找满足以下条件的首个条目：`entry.name === 'save.user.origin.data.from.server.key'`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.name === 'save.user.origin.data.from.server.key');
        const auth = raw ? JSON.parse(raw.value) : null;
        if (!auth?.user_id || !auth?.username || !auth?.api_token?.access_token || !auth?.api_token?.token_type) {
          throw new Error('创建账号状态不完整');
        }
        username = auth.username;
        await context.addInitScript(/** 仅在指定来源注入创建账号所需的本地存储项。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ origin, entries }) => {
          if (location.origin === origin) {
            for (const { name, value } of entries) localStorage.setItem(name, value);
          }
        }, { origin, entries: local.localStorage });
        const accountResponse = page.waitForResponse(/** 匹配`/v11/user/${encodeURIComponent(auth.user_id)}/account` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response => {
          const url = new URL(response.url());
          return url.protocol === 'https:' && url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com')
            && url.pathname === `/v11/user/${encodeURIComponent(auth.user_id)}/account`;
        }, { timeout: 60_000 });
        operation = 'creation-account-setup';
        await openHall(page);
        const response = await accountResponse;
        session = {
          userId: String(auth.user_id), accountUrl: response.url(),
          authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}`,
        };
      } else {
        if (!configuredUsername || !password) throw new Error('缺少创建专用账号环境变量');
        username = configuredUsername;
        operation = 'creation-account-setup';
        await openHall(page);
        operation = 'existing-account-login-ui';
        session = await signIn(page, { username, password });
      }
      operation = 'creation-account-session-check';
      await verifyAccountSession(page, session);
      await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible();
      operation = 'creation-account-notices';
      await clickAfterSignInNotices(page, 'hall-tab');
    } catch (error) {
      await page.close().catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
      throw accountPreparationError(error, operation);
    }
    await setCreationDiamondBalance(session, walletToken);
    await expect.poll(/** 重复读取`readDiamondBalance(page, session)`，直到满足外层等待断言。 */ () => readDiamondBalance(page, session), {
      message: '创建用例开始前应有 60 钻',
    }).toBe(60);
    const account: CreationAccount = { ...session, username, diamondBalance: 60 };
    await use(account);
  },
});

export { expect };
