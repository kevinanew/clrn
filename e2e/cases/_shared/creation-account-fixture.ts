import { readFile } from 'node:fs/promises';
import { test as base, expect, type BrowserContext, type Page } from '../../helpers/diagnostic-test';
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
    const { session, username } = await prepareCreationAccount(page, context);
    await setCreationDiamondBalance(session, walletToken);
    await expect.poll(/** 轮询钻石余额，确认创建专用账号的准备结果已生效。 */ () => readDiamondBalance(page, session), {
      message: '创建用例开始前应有 60 钻',
    }).toBe(60);
    const account: CreationAccount = { ...session, username, diamondBalance: 60 };
    await use(account);
  },
});

export { expect };

type CreationConfiguration = { stateFile?: string; username?: string; password?: string };
type Preparation = { operation: string };

/** 读取创建专用配置；在任何页面初始化前拒绝缺失凭据。 */
function creationConfiguration(): CreationConfiguration {
  const config = { stateFile: process.env.E2E_CREATION_STORAGE_STATE_FILE,
    username: process.env.E2E_CREATION_USERNAME, password: process.env.E2E_CREATION_PASSWORD };
  if (config.stateFile) return config;
  requireCredentials(config, '缺少创建专用账号配置：请设置 E2E_CREATION_USERNAME 和 E2E_CREATION_PASSWORD，或 E2E_CREATION_STORAGE_STATE_FILE');
  return config;
}

/**
 * 校验用户名密码配置，保留固定的配置诊断。
 * @param config - 创建专用配置。
 * @param message - 当前边界的配置错误。
 */
function requireCredentials(config: CreationConfiguration, message: string): asserts config is CreationConfiguration & { username: string; password: string } {
  if (!config.username || !config.password) throw new Error(message);
}

/**
 * 在每个准备边界更新阶段，失败仍关闭页面并脱敏。
 * @param page - 本例页面。
 * @param context - 本例上下文。
 */
async function prepareCreationAccount(page: Page, context: BrowserContext) {
  const config = creationConfiguration();
  const progress = { operation: 'creation-account-setup' };
  try {
    await prepareContext(context);
    const account = config.stateFile
      ? await restoreCreationAccount(page, context, config.stateFile, progress)
      : await loginCreationAccount(page, config, progress);
    await verifyCreationAccount(page, account.session, progress);
    return account;
  } catch (error) {
    await page.close().catch(/** 页面关闭失败不遮盖原准备诊断。 */ () => undefined);
    throw accountPreparationError(error, progress.operation);
  }
}

/**
 * 通过真实表单登录创建专用账号。
 * @param page - 本例页面。
 * @param config - 已检查的配置。
 * @param progress - 当前诊断阶段。
 */
async function loginCreationAccount(page: Page, config: CreationConfiguration, progress: Preparation) {
  requireCredentials(config, '缺少创建专用账号环境变量');
  progress.operation = 'creation-account-setup';
  await openHall(page);
  progress.operation = 'existing-account-login-ui';
  const session = await signIn(page, config);
  return { session, username: config.username };
}

/**
 * 校验 staging 状态中的必填认证字段，任何缺失保持固定错误。
 * @param auth - 本地状态的认证对象。
 */
function validateCreationAuth(auth: any) {
  if (!auth) throw new Error('创建账号状态不完整');
  validateCreationFields(auth, ['user_id', 'username', 'api_token']);
  validateCreationFields(auth.api_token, ['access_token', 'token_type']);
}

/**
 * 校验同一对象的一组真值字段。
 * @param value - 认证对象或令牌。
 * @param fields - 必填字段名。
 */
function validateCreationFields(value: any, fields: string[]) {
  if (!fields.every(/** 检查必填字段。
   * @param field - 字段名。 */ field => value[field])) throw new Error('创建账号状态不完整');
}

/**
 * 只恢复 staging 来源并等待该用户自己的账户请求。
 * @param page - 本例页面。
 * @param context - 本例上下文。
 * @param stateFile - 已配置状态文件。
 * @param progress - 当前诊断阶段。
 */
async function restoreCreationAccount(page: Page, context: BrowserContext, stateFile: string, progress: Preparation) {
  progress.operation = 'creation-account-state';
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as Awaited<ReturnType<BrowserContext['storageState']>>;
  const origin = new URL(environment.stagingUrl).origin;
  const local = state.origins.find(/** 仅接受目标 staging 来源。
   * @param entry - 一个来源。 */ entry => entry.origin === origin);
  if (!local) throw new Error('缺少 staging 创建账号状态');
  const auth = creationAuth(local.localStorage);
  await context.addInitScript(/** 只向目标来源注入缓存。
   * @param state - 目标来源与本地存储项。 */ ({ origin, entries }) => {
    if (location.origin !== origin) return;
    for (const { name, value } of entries) localStorage.setItem(name, value);
  }, { origin, entries: local.localStorage });
  const accountResponse = page.waitForResponse(/** 匹配该用户自己的 staging 账户响应。
   * @param response - 浏览器响应。 */ response => matchesCreationAccount(new URL(response.url()), auth.user_id), { timeout: 60_000 });
  progress.operation = 'creation-account-setup';
  await openHall(page);
  const response = await accountResponse;
  return { username: auth.username, session: { userId: String(auth.user_id), accountUrl: response.url(),
    authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}` } };
}

/**
 * 解析并校验已保存的创建账号认证对象。
 * @param entries - 目标来源的本地存储项。
 */
function creationAuth(entries: { name: string; value: string }[]) {
  const raw = entries.find(/** 查找认证缓存。
   * @param entry - 本地存储项。 */ entry => entry.name === 'save.user.origin.data.from.server.key');
  const auth = raw ? JSON.parse(raw.value) : null;
  validateCreationAuth(auth);
  return auth;
}

/**
 * 匹配 HTTPS staging API 及精确用户路径。
 * @param url - 实际响应地址。
 * @param userId - 当前创建账号用户 ID。
 */
function matchesCreationAccount(url: URL, userId: string) {
  return [url.protocol === 'https:', url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com'),
    url.pathname === `/v11/user/${encodeURIComponent(userId)}/account`].every(Boolean);
}

/**
 * 校验真实会话、登录态与已知提示，并记录失败阶段。
 * @param page - 本例页面。
 * @param session - 当前账号会话。
 * @param progress - 当前诊断阶段。
 */
async function verifyCreationAccount(page: Page, session: Session, progress: Preparation) {
  progress.operation = 'creation-account-session-check';
  await verifyAccountSession(page, session);
  await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible();
  progress.operation = 'creation-account-notices';
  await clickAfterSignInNotices(page, 'hall-tab');
}
