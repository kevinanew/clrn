import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '../../helpers/diagnostic-test';
import { environment } from '../../helpers/environment';
import { parseAccountUrl, verifyAccountSession } from './account-diagnostics';
import { openHall } from './page';
import { readDiamondBalance, registerAccount, type ProvisionedAccount } from './provision';

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
  const api = parseAccountUrl(saved.account.accountUrl);
  validateSavedOrigins(saved, origin, api.origin);
  if (!validAccountApi(api, saved.account.userId)) throw new Error('本轮账号缓存的 staging API 不合法');
  validateStorageOrigin(saved.storageState, origin);
}

export const test = base.extend<{ newAccount: ProvisionedAccount }>({
  /**
   * 提供本轮创建或恢复的测试账号，交给案例执行并验证会话归属。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  newAccount: async ({ page, context, baseURL }, use) => {
    const directory = accountDirectory();
    const origin = accountOrigin(baseURL);
    const accountFile = join(directory, 'account.json');
    const cached = await readSavedAccount(accountFile);
    const saved = cached
      ? await restoreSavedAccount(page, context, cached, origin)
      : await registerSavedAccount(page, context, directory, origin, accountFile);
    expect(new URL(page.url()).origin, '恢复后必须仍为相同 staging').toBe(origin);
    await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
    const sameUser = await page.evaluate(/** 核对浏览器本地缓存中的用户 ID 是否属于本次只读账号。
 * @param userId - 当前操作使用的 userId。 */ (userId) => {
      const raw = localStorage.getItem('save.user.origin.data.from.server.key');
      try {
        return raw !== null && String(JSON.parse(raw).user_id) === userId;
      } catch {
        return false;
      }
    }, saved.account.userId);
    expect(sameUser, '恢复的浏览器会话应属于本轮账号').toBe(true);
    const diamondBalance = await readDiamondBalance(page, saved.account);
    await use({ ...saved.account, diamondBalance });
  },
});

export { expect };

/**
 * 检查缓存 API 的所有独立约束，不放宽来源或用户路径。
 * @param api - 已解析的账户地址。
 * @param userId - 当前账号 ID。
 */
function validAccountApi(api: URL, userId: string) {
  return [api.protocol === 'https:', !api.username, !api.password, !api.search, !api.hash,
    api.hostname.endsWith('.api.staging.laiwan.shafayouxi.com'),
    api.pathname === `/v11/user/${encodeURIComponent(userId)}/account`].every(Boolean);
}

/** 获取必需的单轮账号目录，防止跨轮次复用。 */
function accountDirectory() {
  const directory = process.env.E2E_ACCOUNT_RUN_DIR;
  if (!directory) throw new Error('缺少本轮账号临时目录，请使用 cases/playwright.config.ts');
  return directory;
}

/**
 * 拒绝非配置 staging 的 H5 来源。
 * @param baseURL - Playwright 当前入口。
 */
function accountOrigin(baseURL: string | undefined) {
  const origin = new URL(baseURL || environment.stagingUrl).origin;
  if (origin !== new URL(environment.stagingUrl).origin) throw new Error('创建案例必须使用本轮配置的 staging 来源');
  return origin;
}

/**
 * 只有不存在的文件允许注册；解析或读文件失败仍脱敏并中止。
 * @param accountFile - 本轮缓存文件。
 */
async function readSavedAccount(accountFile: string): Promise<SavedAccount | undefined> {
  try { return JSON.parse(await readFile(accountFile, 'utf8')) as SavedAccount; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line preserve-caught-error -- 缓存解析错误可能包含凭据。
      throw new Error('本轮测试账号缓存不可读取');
    }
  }
}

/**
 * 在新上下文恢复一次，刷新时不重写登录状态。
 * @param page - 当前页面。
 * @param context - 当前浏览器上下文。
 * @param saved - 本轮缓存。
 * @param origin - 允许的 H5 来源。
 */
async function restoreSavedAccount(page: Page, context: BrowserContext, saved: SavedAccount, origin: string) {
  validate(saved, origin);
  await verifyAccountSession(page, saved.account);
  try { await context.setStorageState(saved.storageState); }
  catch { throw new Error('本轮测试账号浏览器状态恢复失败'); }
  await openHall(page);
  return saved;
}

/**
 * 只尝试注册一次，缓存仅保留目标 H5 状态。
 * @param page - 当前页面。
 * @param context - 当前上下文。
 * @param directory - 本轮临时目录。
 * @param origin - 目标 H5 来源。
 * @param accountFile - 本轮缓存文件。
 */
async function registerSavedAccount(page: Page, context: BrowserContext, directory: string, origin: string, accountFile: string) {
  try {
    // 注册失败或 worker 重启时也不能再次注册，避免重复创建测试数据。
    await writeFile(join(directory, 'registration-attempted'), '', { mode: 0o600, flag: 'wx' });
  } catch {
    throw new Error('本轮已尝试注册，未得到可复用账号；不会再次注册');
  }
  const account = await registerAccount(page);
  const browserState = await context.storageState();
  const host = new URL(origin).hostname;
  const saved = {
    origin, apiOrigin: new URL(account.accountUrl).origin, account,
    // 登录页可能加载第三方 iframe；只复用目标 H5 状态，不保存第三方状态。
    storageState: {
      origins: browserState.origins.filter(/** 仅保留满足以下条件的条目：`entry.origin === origin`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.origin === origin),
      cookies: browserState.cookies.filter(/** 选择适用于当前主机及其父域的账号 Cookie。
 * @param cookie - 当前操作使用的 cookie。 */ cookie => {
        const domain = cookie.domain.replace(/^\./, '');
        return host === domain || host.endsWith(`.${domain}`);
      }),
    },
  };
  validate(saved, origin);
  await verifyAccountSession(page, account);
  await writeFile(accountFile, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
  return saved;
}

/**
 * 拒绝变化的 H5 或 API 来源。
 * @param saved - 缓存账号。
 * @param origin - 目标 H5 来源。
 * @param apiOrigin - 实际 API 来源。
 */
function validateSavedOrigins(saved: SavedAccount, origin: string, apiOrigin: string) {
  if (saved.origin !== origin || saved.apiOrigin !== apiOrigin) throw new Error('本轮账号缓存的 H5/API 来源发生变化');
}

/**
 * 浏览器缓存必须精确包含一个目标来源。
 * @param state - 浏览器状态。
 * @param origin - 目标来源。
 */
function validateStorageOrigin(state: StorageState, origin: string) {
  if (state.origins.length !== 1 || state.origins[0].origin !== origin) throw new Error('本轮账号缓存必须仅包含目标 H5 的 localStorage');
}
