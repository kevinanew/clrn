import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus } from './auth';
import { openHall } from './page';
import { readDiamondBalance, registerAccount, type ProvisionedAccount } from './provision';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type SavedAccount = {
  origin: string;
  apiOrigin: string;
  account: ProvisionedAccount;
  storageState: StorageState;
};

function validate(saved: SavedAccount, origin: string): void {
  const api = new URL(saved.account.accountUrl);
  if (saved.origin !== origin || saved.apiOrigin !== api.origin
    || api.protocol !== 'https:' || api.username || api.password || api.search || api.hash
    || !api.hostname.endsWith('.api.staging.laiwan.shafayouxi.com')
    || api.pathname !== `/v11/user/${encodeURIComponent(saved.account.userId)}/account`
    || saved.storageState.origins.some(entry => entry.origin !== origin)) {
    throw new Error('本轮账号缓存必须来自相同 H5 staging 与合法 staging API');
  }
}

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
        throw new Error('本轮测试账号缓存不可读取');
      }
    }

    if (saved) {
      validate(saved, origin);
      await verify(page, saved.account);
      try {
        await context.addCookies(saved.storageState.cookies);
        await context.addInitScript(({ origins }) => {
          const state = origins.find(entry => entry.origin === location.origin);
          if (!state) return;
          for (const { name, value } of state.localStorage) localStorage.setItem(name, value);
        }, { origins: saved.storageState.origins });
      } catch {
        throw new Error('本轮测试账号浏览器状态恢复失败');
      }
      await openHall(page);
    } else {
      try {
        // 注册失败或 worker 重启时也不能再次注册，避免触发同 IP 限额。
        await writeFile(join(directory, 'registration-attempted'), '', { mode: 0o600, flag: 'wx' });
      } catch {
        throw new Error('本轮已尝试注册，未得到可复用账号；不会再次注册');
      }
      let account: ProvisionedAccount;
      try {
        account = await registerAccount(page);
      } catch {
        throw new Error('本轮新账号注册失败；请检查 staging 注册限制，不会自动重试注册');
      }
      saved = {
        origin, apiOrigin: new URL(account.accountUrl).origin, account,
        storageState: await context.storageState(),
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
