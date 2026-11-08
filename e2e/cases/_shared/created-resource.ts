import { expect, type Response } from '@playwright/test';

/**
 * 兼容创建俱乐部响应的两个既有字段名。
 * @param body - 创建响应。
 */
export function clubIdentifier(body: any) {
  const result = body.result || {};
  return result.id || result.club_id;
}

/**
 * 只识别成功响应中的本次真实房间 ID，便于 UI 失败后仍精确清理。
 * @param body - 创建响应。
 */
export function isCreatedRoom(body: any): boolean {
  return body.ok === true && validResourceIdentifier(body.result?.room_id);
}

/**
 * 只识别成功创建响应中的俱乐部 ID。
 * @param body - 创建响应。
 */
export function isCreatedClub(body: any): boolean {
  return body.ok === true && validResourceIdentifier(clubIdentifier(body));
}

/**
 * 保留创建响应 ID 的原有格式要求。
 * @param value - 返回 ID。
 */
function validResourceIdentifier(value: any): boolean { return /^[0-9a-f-]{36}$/.test(value || ''); }

/**
 * 顺序关闭本例创建的所有访客上下文，失败仍传播。
 * @param guests - 本轮访客。
 */
export async function closeGuestContexts(guests: { context: { close: () => Promise<void> } }[]) {
  for (const guest of guests) await guest.context.close();
}

/**
 * 在任何 HTTP 或页面断言前记录本次成功响应的精确房间，确保失败后仍可回收。
 * @param response - 创建请求的真实响应。
 * @param capture - 将本次 ID 与 API 来源记录到案例清理状态。
 */
export async function readCreatedRoom(response: Response, capture: (room: { id: string; cleanupUrl: string; origin: string }) => void) {
  const body = await response.json();
  if (isCreatedRoom(body)) {
    const origin = new URL(response.url()).origin;
    const id = body.result.room_id;
    capture({ id, origin, cleanupUrl: `${origin}/v1/room/${id}` });
  }
  return body;
}

/**
 * 核对创建 HTTP、业务状态和已登记的真实房间 ID，保持断言顺序。
 * @param response - 创建请求响应。
 * @param body - 创建响应正文。
 * @param roomId - 在页面断言前捕获的本次房间 ID。
 */
export function expectCreatedRoom(response: Response, body: any, roomId: string | undefined) {
  expect(response.ok()).toBeTruthy();
  expect(body.ok).toBe(true);
  expect(roomId, '创建成功应返回真实room_id').toBeTruthy();
}
