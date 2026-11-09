/** 真实建房及清理，保留建房操作与请求等待阶段。 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 30_000 });
import { canTopUpVisualAccount } from '../../test-account';
import { readRequestJson, fetchRequestJson } from '../../src/support/requestJson';
import { requestFailure, requestErrorSummary } from '../../src/support/requestError';
import { recordDiagnostic } from '../../src/support/connectionDiagnostics';

export type RoomSession = { roomId: string; apiOrigin: string; authorization: string };
export type Account = { userId: string; username: string; authorization: string };
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 读取页面持久化的账号和认证信息，构建真实房间操作所需的会话。
 * @param page - 执行操作的 Playwright 页面。
 */
async function visualAccount(page: Page) {
  const raw = await page.evaluate(/** 在页面中读取`localStorage.getItem('save.user.origin.data.from.server.key')`，供测试判断当前界面状态。 */ () => localStorage.getItem('save.user.origin.data.from.server.key'))
    .catch(/** 将会话缓存读取失败转换为安全的房间准备诊断。
 * @param error - 当前操作抛出的错误。 */ error => { throw new Error(requestErrorSummary(error, 'room-read-session')); });
  const auth = parseRoomAccount(raw);
  return {
    userId: String(auth.user_id),
    username: String(auth.username),
    authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}`,
  };
}

/**
 * 读取真实钱包响应中的钻石余额，拒绝缺失币种或非数值余额。
 * @param request - Web 或原生测试使用的真实 API 请求客户端。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
async function readDiamondBalance(request: APIRequestContext, account: Account): Promise<number> {
  const response = await request.put(`https://api.shafayouxi.org/v10/wallet/${account.userId}`, {
    headers: { Authorization: account.authorization },
    data: { currencies: ['diamond'] },
  }).catch(/** 将房间测试的钻石余额读取错误转换为安全摘要。
 * @param error - 当前操作抛出的错误。 */ error => {
    throw new Error(requestErrorSummary(error, 'room-read-diamonds'));
  });
  try {
    const body = await readRequestJson(response, 'room-read-diamonds');
    const currencies = body.result?.currencies;
    const diamond = diamondCurrency(currencies);
    const balance = diamondBalance(diamond);
    if (!Number.isFinite(balance)) throw requestFailure('room-read-diamonds', 'invalid-response', response.status());
    return balance;
  } finally {
    await response.dispose().catch(/** 将钻石响应释放失败转换为保留实际 HTTP 状态的诊断。 */ () => { throw requestFailure('room-read-diamonds', 'body-read-failed', response.status()); });
  }
}

/**
 * 确认建房钻石足够，仅允许为受支持的测试账号补充余额。
 * @param request - Web 或原生测试使用的真实 API 请求客户端。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
export async function ensureRoomBalance(request: APIRequestContext, account: Account): Promise<void> {
  if (await readDiamondBalance(request, account) >= 10) return;
  if (!canTopUpVisualAccount(account.username)) {
    throw new Error('仅允许为本轮使用的固定视觉测试账号自动补钻');
  }
  await topUpDiamonds(account);
  await expect.poll(/** 重复读取余额直到补钻生效。 */ () => readDiamondBalance(request, account)).toBe(60);
}

/**
 * 向固定测试接口发起补钻并验证结果。
 * @param account - 已允许补钻的账号。
 */
async function topUpDiamonds(account: Account) {
  const token = topUpToken();
  const { body, status } = await fetchRequestJson(`https://api.shafayouxi.org/public/v1/wallet/${account.userId}/set_balance/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify({ currency_name: 'diamond', balance: '60' }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }, 'room-top-up-diamonds');
  assertTopUp(body.result, account.userId, status);
}

/**
 * 从真实界面创建指定游戏的私人房，立即登记房间以便失败时清理。
 * @param page - 执行操作的 Playwright 页面。
 * @param onCreated - 创建成功后立即登记房间的回调，用于失败时清理。
 * @param gameType - 待创建的私人房游戏类型。
 * @param optionalFeatures - 是否启用可选建房功能。
 * @param onSubmitting - 提交前保存代理边界，供调用方判断预检失败是否可以恢复。
 */
export async function createPrivateGameRoom(
  page: Page,
  onCreated: (room: RoomSession) => void,
  gameType: 'texas_react_native' | 'zhajinhua',
  optionalFeatures = false,
  onSubmitting?: () => Promise<void>,
): Promise<RoomSession> {
  recordDiagnostic(page, '检查建房账号及余额');
  const account = await visualAccount(page);
  await ensureRoomBalance(page.request, account);
  await prepareRoomForm(page, gameType, optionalFeatures);
  await onSubmitting?.();
  return submitRoom(page, account, onCreated);
}

/**
 * 打开真实建房表单并等待玩法遮罩退出。
 * @param page - 当前页面。
 * @param gameType - 游戏类型。
 * @param optionalFeatures - 是否启用高级盲注。
 */
async function prepareRoomForm(page: Page, gameType: string, optionalFeatures: boolean) {
  recordDiagnostic(page, '打开创建房间表单');
  await page.locator('[data-testid="create-game-button"]:visible').last().click();
  await page.locator(`[data-testid="game-type-button-${gameType}"]:visible`).last().click();
  await expect(page.locator('[data-testid="base-create-room-screen"]:visible')).toBeVisible();
  // 表单可能先于玩法弹层的关闭动画出现；等弹层退出后再操作，避免点击落在遮罩上。
  await expect(page.locator('[data-testid^="game-type-button-"]:visible')).toHaveCount(0);
  await page.locator('[data-testid="room-name-input"]:visible').last().fill('TestRoom');
  if (optionalFeatures) {
    await page.locator('[data-testid="advanced-options-button"]:visible').last().click();
    await page.locator('[data-testid="BlindsEnableFlipSwitch"]:visible').last().click();
  }
}

/**
 * 同时等待真实创建响应和点击结果，登记资源后才传播点击错误。
 * @param page - 当前页面。
 * @param account - 已验证的账号。
 * @param onCreated - 立即登记房间的回调。
 */
async function submitRoom(page: Page, account: Account, onCreated: (room: RoomSession) => void): Promise<RoomSession> {
  recordDiagnostic(page, '提交建房并等待响应', { method: 'POST', path: '/v3/pay_action/do', timeoutMs: 60_000 });
  const responsePromise = page.waitForResponse(/** 匹配POST `/v3/pay_action/do` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 })
    .then(/** 将异步结果转换为`{ response }`，供后续步骤使用。
 * @param response - 当前收到的接口响应。 */ response => ({ response }), /** 将异步结果转换为`{ error }`，供后续步骤使用。
 * @param error - 当前操作抛出的错误。 */ error => ({ error }));
  const clickError = await page.locator('[data-testid="creat-room-button"]:visible').last()
    .click().then(/** 将异步结果转换为`null`，供后续步骤使用。 */ () => null, /** 将异步结果转换为`error as Error`，供后续步骤使用。
 * @param error - 当前操作抛出的错误。 */ error => error as Error);
  const result = await responsePromise;
  if ('error' in result) throw new Error(requestErrorSummary(result.error, 'room-create'));
  const response = result.response;
  const body = await readRequestJson(response, 'room-create');
  const roomId = createdRoomId(body, response.status());
  const room = { roomId, apiOrigin: new URL(response.url()).origin, authorization: account.authorization };
  onCreated(room);
  if (clickError) throw requestFailure('room-create', 'request-failed', response.status());
  return room;
}

/**
 * 只删除本用例创建响应中的 UUID；即使截图失败也执行。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 */
export async function deletePrivateGameRoom(room: RoomSession): Promise<void> {
  if (!ROOM_ID_PATTERN.test(room.roomId)) throw new Error('清理房间需要本轮创建响应中的有效 UUID');
  // 固定 staging 入口；客户端选中的地区代理可能已不可用，收尾不再依赖该节点。
  await fetchRequestJson(`https://api.shafayouxi.org/v1/room/${room.roomId}`, {
    method: 'DELETE', headers: { Authorization: room.authorization },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  }, 'room-delete');
  console.log('ROOM CLEANUP > 本次新建房间已解散');
}

/**
 * 解析缓存并逐项验证房间操作需要的身份字段。
 * @param raw - 页面持久化的认证 JSON。
 */
function parseRoomAccount(raw: string | null) {
  let auth;
  try { auth = JSON.parse(raw || 'null'); }
  catch { throw requestFailure('room-read-session', 'invalid-response'); }
  assertAccountId(auth);
  assertAccountToken(auth);
  assertAccountUsername(auth);
  return auth;
}

/**
 * 验证真实账号的 UUID，拒绝缺失缓存。
 * @param auth - 已解析的缓存。
 */
function assertAccountId(auth: { user_id?: string } | null) {
  const userId = auth?.user_id;
  if (!ROOM_ID_PATTERN.test(String(userId))) throw requestFailure('room-read-session', 'invalid-response');
}

/**
 * 验证缓存包含有效令牌。
 * @param auth - 已验证账号 ID 的缓存。
 */
function assertAccountToken(auth: { api_token?: { access_token?: string } }) {
  if (!auth.api_token?.access_token) throw requestFailure('room-read-session', 'invalid-response');
}

/**
 * 在真实钱包币种列表中选择钻石项。
 * @param currencies - 接口币种字段。
 */
function diamondCurrency(currencies: unknown) {
  if (!Array.isArray(currencies)) return undefined;
  return currencies.find(/** 按币种代码匹配钻石。
   * @param item - 钱包币种。 */ item => item?.code === 'diamond');
}

/**
 * 读取仅供测试账号补钻使用的令牌。
 */
function topUpToken() {
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  return token;
}

/**
 * 检查补钻响应的账号、币种及余额，保留真实 HTTP 状态。
 * @param result - 补钻结果字段。
 * @param userId - 本轮账号。
 * @param status - 实际 HTTP 状态。
 */
function assertTopUp(result: { wallet_id?: string; currency_name?: string; balance?: string } | undefined,
  userId: string, status: number) {
  const expected = { wallet_id: userId, currency_name: 'diamond', balance: 60 };
  for (const [key, value] of Object.entries(expected)) {
    if (topUpValue(result, key) !== value) throw requestFailure('room-top-up-diamonds', 'invalid-response', status);
  }
}

/**
 * 按原接口规则读取字段，余额仍转换为数值。
 * @param result - 实际响应结果。
 * @param key - 待核对的字段。
 */
function topUpValue(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return key === 'balance' ? Number(value) : value;
}

/**
 * 从建房响应读取并验证 UUID。
 * @param body - 创建响应正文。
 * @param status - 实际 HTTP 状态。
 */
function createdRoomId(body: { result?: { room_id?: string } } | undefined, status: number): string {
  const roomId = body?.result?.room_id;
  return validCreatedRoomId(roomId, status);
}

/**
 * 拒绝非本轮创建响应的房间标识。
 * @param roomId - 响应中的房间标识。
 * @param status - 实际 HTTP 状态。
 */
function validCreatedRoomId(roomId: string | undefined, status: number): string {
  if (!ROOM_ID_PATTERN.test(roomId || '')) throw requestFailure('room-create', 'invalid-response', status);
  return roomId!;
}

/**
 * 保留钻石余额的数值转换语义。
 * @param diamond - 钻石币种项。
 */
function diamondBalance(diamond: { balance?: unknown } | undefined) { return Number(diamond?.balance); }

/**
 * 房间账号必须包含用户名。
 * @param auth - 已验证账号和令牌的缓存。
 */
function assertAccountUsername(auth: { username?: string }) {
  if (!auth.username) throw requestFailure('room-read-session', 'invalid-response');
}
