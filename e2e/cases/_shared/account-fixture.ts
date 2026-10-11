import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus } from './auth';
import { openHall } from './page';
import { readDiamondBalance, registerAccount, RegistrationRejectedError, type ProvisionedAccount } from './provision';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type SavedAccount = {
  origin: string;
  apiOrigin: string;
  account: ProvisionedAccount;
  storageState: StorageState;
};

/**
 * 校验缓存账号的 H5 来源、staging API 地址和浏览器状态，拒绝跨环境复用。
 * @param saved - 本轮已保存的账号会话和浏览器状态。
 * @param origin - 允许使用的页面来源。
 */
function validate(saved: SavedAccount, origin: string): void {
  const api = new URL(saved.account.accountUrl);
  if (saved.origin !== origin || saved.apiOrigin !== api.origin) {
    throw new Error('本轮账号缓存的 H5/API 来源发生变化');
  }
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash
    || !api.hostname.endsWith('.api.staging.laiwan.shafayouxi.com')
    || api.pathname !== `/v11/user/${encodeURIComponent(saved.account.userId)}/account`) {
    throw new Error(`本轮账号缓存的 staging API 不合法（host=${api.hostname}）`);
  }
  if (saved.storageState.origins.length !== 1 || saved.storageState.origins[0].origin !== origin) {
    throw new Error('本轮账号缓存必须仅包含目标 H5 的 localStorage');
  }
}

/**
 * 读取受保护的账号接口确认会话有效，失效时直接失败，避免重复登录。
 * @param page - 执行操作的 Playwright 页面。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
async function verify(page: Page, account: ProvisionedAccount): Promise<void> {
  // 网络库错误可能带 Authorization 请求头；只抛固定信息，避免写入报告。
  let status: number;
  try {
    status = await accountStatus(page, account);
  } catch {
    throw new Error('本轮测试账号会话检查请求失败');
  }
  expect(status, '本轮测试账号会话必须有效，禁止重复登录或重新注册').toBe(200);
}

export const test = base.extend<{ newAccount: ProvisionedAccount }>({
  /**
   * 提供本轮创建或恢复的测试账号，交给案例执行并验证会话归属。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  newAccount: async ({ page, context, baseURL }, use) => {
    const directory = process.env.E2E_ACCOUNT_RUN_DIR;
    if (!directory) throw new Error('缺少本轮账号临时目录，请使用 cases/playwright.config.ts');
    const origin = new URL(baseURL || environment.stagingUrl).origin;
    if (origin !== new URL(environment.stagingUrl).origin) {
      throw new Error('创建案例必须使用本轮配置的 staging 来源');
    }
    const accountFile = join(directory, 'account.json');
    let saved: SavedAccount | undefined;
    try {
      saved = JSON.parse(await readFile(accountFile, 'utf8')) as SavedAccount;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line preserve-caught-error -- JSON 解析错误可能包含账号缓存原文，不附加到 cause。
        throw new Error('本轮测试账号缓存不可读取');
      }
    }

    if (saved) {
      validate(saved, origin);
      await verify(page, saved.account);
      try {
        // 只在新上下文恢复一次。addInitScript 会在每次刷新时重写登录缓存，
        // 掩盖应用丢失持久化状态的问题，使注册后的刷新测试产生假阳性。
        await context.setStorageState(saved.storageState);
      } catch {
        throw new Error('本轮测试账号浏览器状态恢复失败');
      }
      await openHall(page);
    } else {
      try {
        // 注册失败或 worker 重启时也不能再次注册，避免重复创建测试数据。
        await writeFile(join(directory, 'registration-attempted'), '', { mode: 0o600, flag: 'wx' });
      } catch {
        throw new Error('本轮已尝试注册，未得到可复用账号；不会再次注册');
      }
      let account: ProvisionedAccount;
      try {
        account = await registerAccount(page);
      } catch (error) {
        if (error instanceof RegistrationRejectedError) throw error;
        // eslint-disable-next-line preserve-caught-error -- 登录错误可能包含密码或 Authorization，不附加到 cause。
        throw new Error('本轮新账号注册失败；请检查 staging 测试接口、token 及登录流程，不会自动重试注册');
      }
      const browserState = await context.storageState();
      const host = new URL(origin).hostname;
      saved = {
        origin, apiOrigin: new URL(account.accountUrl).origin, account,
        // 登录页可能加载第三方 iframe；只复用目标 H5 状态，不保存第三方状态。
        storageState: {
          origins: browserState.origins.filter(entry => entry.origin === origin),
          cookies: browserState.cookies.filter(cookie => {
            const domain = cookie.domain.replace(/^\./, '');
            return host === domain || host.endsWith(`.${domain}`);
          }),
        },
      };
      validate(saved, origin);
      await verify(page, account);
      await writeFile(accountFile, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
    }
    expect(new URL(page.url()).origin, '恢复后必须仍为相同 staging').toBe(origin);
    await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
    const sameUser = await page.evaluate((userId) => {
      const raw = localStorage.getItem('save.user.origin.data.from.server.key');
      try {
        return raw !== null && String(JSON.parse(raw).user_id) === userId;
      } catch {
        return false;
      }
    }, saved.account.userId);
    expect(sameUser, '恢复的浏览器会话应属于本轮账号').toBe(true);
    let diamondBalance: number;
    try {
      diamondBalance = await readDiamondBalance(page, saved.account);
    } catch {
      throw new Error('本轮测试账号实时钻石余额读取失败');
    }
    await use({ ...saved.account, diamondBalance });
  },
});

export { expect };
