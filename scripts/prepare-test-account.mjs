import { requestFailure, requestFailureReason } from './request-failure.cjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const stagingOrigin = 'https://api.shafayouxi.org';
export const initialCoinBalance = '10000';

/** 判断本机部署文件中的 Secret 身份。
 * @param document - 单份 YAML 文档。 */
function testingSecret(document) {
  return [/^kind:\s*Secret\s*$/m, /^\s+name:\s*test-api-token\s*$/m, /^\s+namespace:\s*goplay-staging\s*$/m].every(
    /** 核对 Secret 必须匹配的字段。
     * @param pattern - 已登记字段表达式。 */ pattern => pattern.test(document));
}

/** 安全读取本机令牌，底层文件错误不能泄露凭据。
 * @param deploymentFile - 本机部署文件。 */
async function localTestingToken(deploymentFile) {
  try {
    const deployment = await readFile(deploymentFile, 'utf8');
    const secret = deployment.split(/^---\s*$/m).find(testingSecret);
    return secretToken(secret);
  } catch { /* 统一报告缺少配置，不输出底层凭据。 */ }
}

/** 从匹配的 Secret 解析令牌字符串。
 * @param secret - 可选 Secret 文档。 */
function secretToken(secret) {
  return secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
}

/** 仅本机允许回退到部署文件。
 * @param environment - 当前进程环境。 */
function allowsLocalToken(environment) { return !environment.CI && environment.GITHUB_ACTIONS !== 'true'; }

/** 从环境或本机 staging 部署文件读取令牌，CI 禁止文件回退。
 * @param environment - 当前环境配置。
 * @param deploymentFile - 本机共用 staging Secret 文件。 */
export async function readTestingApiToken(environment = process.env,
  deploymentFile = new URL('../../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml', import.meta.url)) {
  return environmentTestingToken(environment, deploymentFile);
}

/** 优先使用显式令牌，缺失时才考虑本机回退。
 * @param environment - 当前环境。
 * @param deploymentFile - 本机部署文件。 */
async function environmentTestingToken(environment, deploymentFile) {
  const configured = environment.TESTING_API_TOKEN?.trim();
  return configured || await fallbackTestingToken(environment, deploymentFile);
}

/** 在允许的本机环境尝试文件，并统一拒绝缺失令牌。
 * @param environment - 当前环境配置。
 * @param deploymentFile - 本机部署文件。 */
async function fallbackTestingToken(environment, deploymentFile) {
  const token = allowsLocalToken(environment) ? await localTestingToken(deploymentFile) : undefined;
  if (token) return token;
  throw new Error('缺少 TESTING_API_TOKEN，无法准备测试账号金币余额');
}

/** 解析正文并保留真实状态与错误阶段。
 * @param response - 实际响应。
 * @param operation - 逻辑操作标识。 */
async function responseJson(response, operation) {
  try { return await response.json(); }
  catch (error) { throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', response.status); }
}

/** 验证业务成功与结果存在性。
 * @param result - 已解析业务响应。 */
function acceptedResult(result) { return result?.ok === true && result.result; }

/** 请求固定 staging 入口，拒绝重定向并保留安全错误。
 * @param path - 业务路径。
 * @param method - HTTP 方法。
 * @param body - 请求 JSON。
 * @param headers - 接口认证头。
 * @param operation - 逻辑操作标识。 */
async function requestJson(path, method, body, headers, operation) {
  let response;
  try {
    response = await fetch(`${stagingOrigin}${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch (error) { throw requestFailure(operation, requestFailureReason(error)); }
  return checkedResponse(response, operation);
}

/** 核对传输状态和业务结果。
 * @param response - 实际响应。
 * @param operation - 逻辑操作标识。 */
async function checkedResponse(response, operation) {
  if (!response.ok) throw requestFailure(operation, 'http-error', response.status);
  const result = await responseJson(response, operation);
  if (!acceptedResult(result)) throw requestFailure(operation, 'business-rejected', response.status);
  return { result: result.result, status: response.status };
}

/** 验证字符串长度及密码控制字符。
 * @param password - 候选密码。 */
function validPassword(password) {
  if (typeof password !== 'string') return false;
  return [password.length > 0, password.length <= 20, !/[\r\n\0]/.test(password)].every(Boolean);
}

/** 核对凭据，避免无效用户名进入真实登录。
 * @param account - 待准备账号。
 * @param token - 测试接口令牌。 */
function validateCredentials(account, token) {
  validateTestingToken(token);
  if (!validAccount(account)) throw new Error('测试账号凭据无效');
}

/** 保留用户名类型及密码契约。
 * @param account - 待准备账号。 */
function validAccount(account) {
  if (!account) return false;
  return validUsername(account.username) && validPassword(account.password);
}

/** 核对登录会话身份与账号登记的用户编号。
 * @param session - 登录返回的会话。
 * @param account - 独占账号。 */
function validSessionIdentity(session, account) {
  if (typeof session.user_id !== 'string') return false;
  return [
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.user_id),
    session.username === account.username, registeredUserMatches(account, session.user_id),
  ].every(Boolean);
}

/** 未登记编号时接受服务端身份，否则必须精确一致。
 * @param account - 独占账号。
 * @param userId - 实际用户编号。 */
function registeredUserMatches(account, userId) { return account.userId === undefined || account.userId === userId; }

/** 核对登录 token 类型及内容，拒绝头部控制字符。
 * @param token - 登录返回的 API token。 */
function validSessionToken(token) {
  if (!bearerToken(token)) return false;
  if (typeof token.access_token !== 'string') return false;
  return validAccessToken(token.access_token);
}

/** 拒绝空或含换行的访问令牌。
 * @param token - 字符串访问令牌。 */
function validAccessToken(token) { return Boolean(token) && !/[\r\n]/.test(token); }

/** 核对服务端的余额设置结果。
 * @param setting - 含真实状态的设置响应。
 * @param userId - 当前账号编号。 */
function validateSetting(setting, userId) {
  const expected = { wallet_id: userId, currency_name: 'coin' };
  const matches = Object.entries(expected).every(/** 先核对账号及币种，再转换余额。
   * @param entry - 预期字段和值。 */ ([key, value]) => setting.result[key] === value);
  if (!matches || Number(setting.result.balance) !== Number(initialCoinBalance)) {
    throw requestFailure('prepare-account-set-coins', 'invalid-response', setting.status);
  }
}

/** 从钱包响应选出金币，保留非数组时的拒绝语义。
 * @param wallet - 钱包业务结果。 */
function walletCoins(wallet) {
  return Array.isArray(wallet.currencies) ? wallet.currencies.filter(
    /** 仅选择金币记录。
     * @param currency - 钱包币种。 */ currency => currency?.code === 'coin') : [];
}

/** 核对钱包只有一条金币记录且余额精确符合预期。
 * @param reading - 钱包响应。 */
function validateWallet(reading) {
  const coins = walletCoins(reading.result);
  if (coins.length !== 1 || Number(coins[0].balance) !== Number(initialCoinBalance)) {
    throw requestFailure('prepare-account-verify-coins', 'invalid-response', reading.status);
  }
}

/** 在账号锁内准备固定金币，并通过真实钱包接口核对。
 * @param account - 已独占的账号凭据及可选用户编号。
 * @param token - 仅在 Node 进程使用的测试接口令牌。 */
export async function prepareTestAccountCoins(account, token) {
  validateCredentials(account, token);
  const login = await requestJson('/public/v10/user/login/username/password', 'POST', {
    username: account.username, password: account.password, device_id: randomUUID(),
  }, {}, 'prepare-account-login');
  const session = login.result;
  if (!validSessionIdentity(session, account) || !validSessionToken(session.api_token)) {
    throw requestFailure('prepare-account-login', 'invalid-response', login.status);
  }
  const userId = session.user_id;
  const setting = await requestJson(`/public/v1/wallet/${userId}/set_balance/testing`, 'POST', {
    currency_name: 'coin', balance: initialCoinBalance,
  }, { 'X-Testing-Api-Token': token }, 'prepare-account-set-coins');
  validateSetting(setting, userId);
  const authorization = `${session.api_token.token_type} ${session.api_token.access_token}`;
  const reading = await requestJson(`/v10/wallet/${userId}`, 'PUT', { currencies: ['coin'] }, {
    Authorization: authorization,
  }, 'prepare-account-verify-coins');
  validateWallet(reading);
  return { userId, authorization };
}

/** 拒绝缺失或空白测试接口令牌。
 * @param token - 测试接口令牌。 */
function validateTestingToken(token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('缺少 TESTING_API_TOKEN');
}

/** 核对账号用户名类型及允许格式。
 * @param username - 候选用户名。 */
function validUsername(username) { return typeof username === 'string' && /^[a-zA-Z0-9.]{6,30}$/.test(username); }

/** 核对可选 token 对象的认证类型。
 * @param token - 服务端 token。 */
function bearerToken(token) { return /^Bearer$/i.test(token?.token_type); }
