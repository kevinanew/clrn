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
  const raw = await page.evaluate(() => localStorage.getItem('save.user.origin.data.from.server.key'))
    .catch(error => { throw new Error(requestErrorSummary(error, 'room-read-session')); });
  let auth;
  try { auth = raw ? JSON.parse(raw) : null; }
  catch { throw requestFailure('room-read-session', 'invalid-response'); }
  if (!ROOM_ID_PATTERN.test(auth?.user_id || '') || !auth?.api_token?.access_token || !auth?.username) {
    throw requestFailure('room-read-session', 'invalid-response');
  }
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
  }).catch(error => {
    throw new Error(requestErrorSummary(error, 'room-read-diamonds'));
  });
  try {
    const body = await readRequestJson(response, 'room-read-diamonds');
    const currencies = body.result?.currencies;
    const diamond = Array.isArray(currencies) ? currencies.find((item: { code: string }) => item?.code === 'diamond') : undefined;
    const balance = Number(diamond?.balance);
    if (!Number.isFinite(balance)) throw requestFailure('room-read-diamonds', 'invalid-response', response.status());
    return balance;
  } finally {
    await response.dispose().catch(() => { throw requestFailure('room-read-diamonds', 'body-read-failed', response.status()); });
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
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  const { body, status } = await fetchRequestJson(`https://api.shafayouxi.org/public/v1/wallet/${account.userId}/set_balance/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify({ currency_name: 'diamond', balance: '60' }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }, 'room-top-up-diamonds');
  if (body.result?.wallet_id !== account.userId
    || body.result?.currency_name !== 'diamond' || Number(body.result?.balance) !== 60) {
    throw requestFailure('room-top-up-diamonds', 'invalid-response', status);
  }
  await expect.poll(() => readDiamondBalance(request, account)).toBe(60);
}

/**
 * 从真实界面创建指定游戏的私人房，立即登记房间以便失败时清理。
 * @param page - 执行操作的 Playwright 页面。
 * @param onCreated - 创建成功后立即登记房间的回调，用于失败时清理。
 * @param gameType - 待创建的私人房游戏类型。
 * @param optionalFeatures - 是否启用可选建房功能。
 */
export async function createPrivateGameRoom(
  page: Page,
  onCreated: (room: RoomSession) => void,
  gameType: 'texas_react_native' | 'zhajinhua',
  optionalFeatures = false,
): Promise<RoomSession> {
  recordDiagnostic(page, '检查建房账号及余额');
  const account = await visualAccount(page);
  await ensureRoomBalance(page.request, account);
  recordDiagnostic(page, '打开创建房间表单');
  await page.locator('[data-testid="create-game-button"]:visible').last().click();
  await page.locator(`[data-testid="game-type-button-${gameType}"]:visible`).last().click();
  await expect(page.locator('[data-testid="base-create-room-screen"]:visible')).toBeVisible();
  await page.locator('[data-testid="room-name-input"]:visible').last().fill('TestRoom');
  if (optionalFeatures) {
    await page.locator('[data-testid="advanced-options-button"]:visible').last().click();
    await page.locator('[data-testid="BlindsEnableFlipSwitch"]:visible').last().click();
  }
  recordDiagnostic(page, '提交建房并等待响应', { method: 'POST', path: '/v3/pay_action/do', timeoutMs: 60_000 });
  const responsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 })
    .then(response => ({ response }), error => ({ error }));
  const clickError = await page.locator('[data-testid="creat-room-button"]:visible').last()
    .click().then(() => null, error => error as Error);
  const result = await responsePromise;
  if ('error' in result) throw new Error(requestErrorSummary(result.error, 'room-create'));
  const response = result.response;
  const body = await readRequestJson(response, 'room-create');
  const roomId = body?.result?.room_id;
  if (!ROOM_ID_PATTERN.test(roomId || '')) {
    throw requestFailure('room-create', 'invalid-response', response.status());
  }
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
