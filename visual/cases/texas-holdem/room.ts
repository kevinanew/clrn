import type { Page } from '@playwright/test';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../_shared/room';
import { readRequestJson } from '../../src/support/requestJson';
import { requestErrorSummary, requestFailure } from '../../src/support/requestError';

/**
 * 创建德州私人房并把房间信息交给调用方登记清理。
 * @param page - 执行操作的 Playwright 页面。
 * @param onCreated - 创建成功后立即登记房间的回调，用于失败时清理。
 * @param optionalFeatures - 是否启用可选建房功能。
 */
export function createTexasRoom(page: Page, onCreated: (room: RoomSession) => void, optionalFeatures = false) {
  return createPrivateGameRoom(page, onCreated, 'texas_react_native', optionalFeatures);
}

/**
 * 只为本用例创建的私人房建立真实观察者连接。
 * @param page - 执行操作的 Playwright 页面。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 */
export async function enterTexasRoom(page: Pick<Page, 'request'>, room: RoomSession): Promise<void> {
  const response = await page.request.put(`${room.apiOrigin}/v10/texas_holdem/room/${room.roomId}/enter`, {
    headers: { Authorization: room.authorization }, data: { client_support: ['time_based_rules'] },
    timeout: 15_000,
  }).catch(error => {
    throw new Error(requestErrorSummary(error, 'texas-enter'));
  });
  try {
    await readRequestJson(response, 'texas-enter');
  } finally {
    await response.dispose().catch(() => { throw requestFailure('texas-enter', 'body-read-failed', response.status()); });
  }
}

export const deleteTexasRoom = deletePrivateGameRoom;
