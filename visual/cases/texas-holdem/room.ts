import type { Page } from '@playwright/test';
import { expect } from './proxy';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../_shared/room';
import { requestErrorSummary } from '../../src/support/requestError';

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
export async function enterTexasRoom(page: Page, room: RoomSession): Promise<void> {
  const response = await page.request.put(`${room.apiOrigin}/v10/texas_holdem/room/${room.roomId}/enter`, {
    headers: { Authorization: room.authorization }, data: { client_support: ['time_based_rules'] },
    timeout: 15_000,
  }).catch(error => {
    throw new Error(`德州观察者连接请求失败：${requestErrorSummary(error)}`);
  });
  const body = await response.json();
  expect(response.ok() && body?.ok === true, '大厅显示夹具使用当前私人房的真实观察者连接').toBe(true);
  await response.dispose();
}

export const deleteTexasRoom = deletePrivateGameRoom;
