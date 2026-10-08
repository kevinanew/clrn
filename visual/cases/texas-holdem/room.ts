import { expect, type Page } from '@playwright/test';
import { canTopUpVisualAccount } from '../../test-account';

type RoomSession = { roomId: string; apiOrigin: string; authorization: string };
type Account = { userId: string; username: string; authorization: string };
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function visualAccount(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem('save.user.origin.data.from.server.key'));
  const auth = raw ? JSON.parse(raw) : null;
  if (!ROOM_ID_PATTERN.test(auth?.user_id || '') || !auth?.api_token?.access_token || !auth?.username) {
    throw new Error('视觉测试登录态缺少有效用户 ID 或 API token');
  }
  return {
    userId: String(auth.user_id),
    username: String(auth.username),
    authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}`,
  };
}

async function readDiamondBalance(page: Page, account: Account): Promise<number> {
  const response = await page.request.put(`https://api.shafayouxi.org/v10/wallet/${account.userId}`, {
    headers: { Authorization: account.authorization },
    data: { currencies: ['diamond'] },
  });
  const body = await response.json();
  await response.dispose();
  if (!response.ok() || body?.ok !== true) throw new Error('无法读取视觉测试账号钻石余额');
  const diamond = body.result?.currencies?.find((item: { code: string }) => item.code === 'diamond');
  const balance = Number(diamond?.balance);
  if (!Number.isFinite(balance)) throw new Error('视觉测试账号钻石余额无效');
  return balance;
}

async function ensureRoomBalance(page: Page, account: Account): Promise<void> {
  if (await readDiamondBalance(page, account) >= 10) return;
  if (!canTopUpVisualAccount(account.username)) {
    throw new Error('仅允许为本轮使用的固定视觉测试账号自动补钻');
  }
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  const response = await fetch(`https://api.shafayouxi.org/public/v1/wallet/${account.userId}/set_balance/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify({ currency_name: 'diamond', balance: '60' }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true || body.result?.wallet_id !== account.userId
    || body.result?.currency_name !== 'diamond' || Number(body.result?.balance) !== 60) {
    throw new Error('staging 测试账号补钻结果无效');
  }
  await expect.poll(() => readDiamondBalance(page, account)).toBe(60);
}

export async function createTexasRoom(
  page: Page,
  onCreated: (room: RoomSession) => void,
  optionalFeatures = false,
): Promise<RoomSession> {
  const account = await visualAccount(page);
  await ensureRoomBalance(page, account);
  await page.locator('[data-testid="create-game-button"]:visible').last().click();
  await page.locator('[data-testid="game-type-button-texas_react_native"]:visible').last().click();
  await expect(page.locator('[data-testid="base-create-room-screen"]:visible')).toBeVisible();
  await page.locator('[data-testid="room-name-input"]:visible').last().fill('TestRoom');
  if (optionalFeatures) {
    await page.locator('[data-testid="advanced-options-button"]:visible').last().click();
    await page.locator('[data-testid="BlindsEnableFlipSwitch"]:visible').last().click();
  }
  const responsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
  const clickError = await page.locator('[data-testid="creat-room-button"]:visible').last()
    .click().then(() => null, error => error as Error);
  const response = await responsePromise;
  const body = await response.json();
  const roomId = body?.result?.room_id;
  if (!response.ok() || body?.ok !== true || !ROOM_ID_PATTERN.test(roomId || '')) {
    const errorCode = body?.error_type ?? body?.error?.code ?? body?.error_code ?? body?.code ?? 'unknown';
    const resultKeys = body?.result && typeof body.result === 'object' ? Object.keys(body.result).join(',') : 'none';
    const topKeys = body && typeof body === 'object' ? Object.keys(body).join(',') : 'none';
    const reason = body?.error_message ?? body?.error?.message ?? body?.error ?? body?.message ?? body?.reason ?? '';
    const fields = JSON.stringify(body?.errors ?? []).slice(0, 300);
    throw new Error(`德州房间创建失败：HTTP ${response.status()}，ok=${String(body?.ok)}，业务代码 ${String(errorCode).slice(0, 80)}，顶层字段 ${topKeys}，结果字段 ${resultKeys}，原因 ${String(reason).slice(0, 120)}，校验字段 ${fields}`);
  }
  const room = { roomId, apiOrigin: new URL(response.url()).origin, authorization: account.authorization };
  onCreated(room);
  if (clickError) throw clickError;
  return room;
}

/** 只删除本用例创建响应中的 UUID；即使截图失败也执行。 */
export async function deleteTexasRoom(page: Page, room: RoomSession): Promise<void> {
  const blindsOpen = await page.locator('[data-testid="raise-blind-detail"]:visible')
    .isVisible().catch(() => false);
  if (!blindsOpen && await page.locator('[data-testid="run-game-view"]:visible').isVisible().catch(() => false)) {
    await page.locator('[data-testid="menu-button"]:visible').last().click().catch(() => undefined);
    await page.locator('[data-testid="drawer-menu-item-exit"]:visible').last().click().catch(() => undefined);
  }
  const response = await page.request.delete(`${room.apiOrigin}/v1/room/${room.roomId}`, {
    headers: { Authorization: room.authorization }, timeout: 15_000,
  });
  const body = await response.json().catch(() => null);
  expect(response.ok() && body?.ok === true, '本次新建德州房间应成功解散').toBe(true);
  await response.dispose();
}
