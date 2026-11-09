/** 德州场景的前置配置、入场响应识别与失败清理。 */
import type { BrowserContext, Page, Response } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import type { RoomSession } from '../_shared/room';
import { deleteTexasRoom } from './room';

/**
 * 仅捕获当前新版牌谱场景、本轮房间的实际入场响应。
 * @param scenario - 当前视觉配置。
 * @param room - 已登记的本轮房间。
 * @param response - 浏览器响应。
 */
export function matchesRecordEntry(scenario: VisualScenario, room: RoomSession | undefined, response: Response): boolean {
  if (scenario.pageLabel !== 'signed_in_texas_records_v2') return false;
  return room ? isRoomEntry(response, room.roomId) : false;
}

/**
 * 精确匹配方法和当前房间路径。
 * @param response - 浏览器响应。
 * @param roomId - 当前房间标识。
 */
function isRoomEntry(response: Response, roomId: string): boolean {
  return response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/v10/texas_holdem/room/${roomId}/enter`;
}

/**
 * 在导航前按原有场景安装时钟并准备特殊权限。
 * @param page - 当前页面。
 * @param scenario - 当前视觉配置。
 * @param proxy - 本轮独占代理。
 */
export async function prepareScenarioContext(page: Page, scenario: VisualScenario, proxy: TexasProxy) {
  if (!['signed_in_texas_pre_game', 'signed_in_texas_optional_pre_game'].includes(scenario.pageLabel)) {
    await page.clock.install({ time: Date.now() });
  }
  await configureSpecialContext(page.context(), scenario, proxy);
}

/**
 * 保留新版牌谱和语音面板的专用前置条件。
 * @param context - 当前浏览器上下文。
 * @param scenario - 当前视觉配置。
 * @param proxy - 本轮独占代理。
 */
async function configureSpecialContext(context: BrowserContext, scenario: VisualScenario, proxy: TexasProxy) {
  if (scenario.pageLabel === 'signed_in_texas_records_v2') await proxy.configureNewRecords(true);
  if (scenario.pageLabel === 'signed_in_texas_panels') await context.grantPermissions(['microphone']);
}

/**
 * 导航后核对新版牌谱开关，其他场景不读取该缓存。
 * @param page - 当前页面。
 * @param scenario - 当前视觉配置。
 */
export async function assertRecordsVersion(page: Page, scenario: VisualScenario) {
  if (scenario.pageLabel !== 'signed_in_texas_records_v2') return;
  await expect.poll(/** 读取应用实际保存的牌谱版本开关。 */ () => page.evaluate(
    /** 从页面存储读取当前版本。 */ () => localStorage.getItem('use.new.game.record.key'))).toBe('true');
}

/**
 * 在建房前切换原有大厅或游客视角。
 * @param proxy - 本轮独占代理。
 * @param scenario - 当前视觉配置。
 */
export async function configureScenarioView(proxy: TexasProxy, scenario: VisualScenario) {
  if (['signed_in_texas_hall', 'signed_in_texas_hall_variants'].includes(scenario.pageLabel)) await proxy.configureHallView();
  if (scenario.pageLabel === 'signed_in_texas_table_states') await proxy.configureGuestView();
}

/**
 * 无论删房或释放代理是否失败，最终都关闭浏览器上下文。
 * @param context - 当前浏览器上下文。
 * @param proxy - 本轮独占代理。
 * @param room - 本轮已登记的房间。
 */
export async function cleanupTexasScenario(context: Pick<BrowserContext, 'close'>,
  proxy: Pick<TexasProxy, 'releaseTexas'>, room: RoomSession | undefined) {
  try {
    try { if (room) await deleteTexasRoom(room); }
    finally { await proxy.releaseTexas(); }
  } finally { await context.close(); }
}

