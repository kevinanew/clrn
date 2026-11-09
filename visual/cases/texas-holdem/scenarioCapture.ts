/** 德州截图场景分发，保留每种场景原有入房、连接和加载条件。 */
import type { Page, Response } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';
import { readRequestJson } from '../../src/support/requestJson';
import { recordDiagnostic } from '../../src/support/connectionDiagnostics';
import { expect, type TexasProxy } from './proxy';
import { enterTexasRoom } from './room';
import type { RoomSession } from '../_shared/room';
import { captureGameplay } from './gameplay';
import { capturePanels } from './panels';
import { captureHall } from './hall';
import { captureNewRecords } from './records';
import { captureControls } from './controlVariants';
import { captureTableStates } from './tableVariants';
import { capturePanelVariants } from './panelVariants';
import { captureHallVariants } from './hallVariants';
import type { Capture } from './variantSupport';

type ScenarioCapture = {
  page: Page; scenario: VisualScenario; proxy: TexasProxy; room: RoomSession; optional: boolean;
  capture: Capture;
  preGame: (page: Page, scenario: VisualScenario) => Promise<void>;
  optionalPreGame: (page: Page, scenario: VisualScenario) => Promise<void>;
  waitForGameConnection: (page: Page) => Promise<void>;
  getRecordEntry: () => Response | undefined;
};

/**
 * 以明确数据表选择场景流程，未知标签仍采用原有开局前分支。
 * @param state - 本轮独占的页面、代理、房间及截图回调。
 */
export async function captureTexasScenario(state: ScenarioCapture): Promise<void> {
  const handlers: Record<string, () => Promise<void>> = {
    /** 操作按钮场景。 */
    signed_in_texas_controls: () => captureVariant(state, captureControls),
    /** 游客桌面场景。 */
    signed_in_texas_table_states: () => captureVariant(state, captureTableStates),
    /** 面板变体场景。 */
    signed_in_texas_panel_variants: () => captureVariant(state, capturePanelVariants),
    /** 大厅变体场景。 */
    signed_in_texas_hall_variants: () => captureVariant(state, captureHallVariants),
    /** 真实连接后执行牌局回放。 */
    signed_in_texas_game: () => captureConnected(state, captureGameplay),
    /** 真实连接后执行面板回放。 */
    signed_in_texas_panels: () => captureConnected(state, capturePanels),
    /** 观察者入房后执行大厅回放。 */
    signed_in_texas_hall: () => captureHallScenario(state),
    /** 新版牌谱依赖本轮浏览器入场会话。 */
    signed_in_texas_records_v2: () => captureRecordScenario(state),
  };
  const handler = handlers[state.scenario.pageLabel];
  if (handler) return handler();
  const fallback = state.optional ? state.optionalPreGame : state.preGame;
  await fallback(state.page, state.scenario);
}

/**
 * 准备需要重试加载和可选观察者入房的变体。
 * @param state - 本轮场景资源。
 * @param handler - 原有变体截图实现。
 */
async function captureVariant(state: ScenarioCapture, handler: typeof captureControls) {
  const { page, scenario, proxy, room, capture } = state;
  if (['signed_in_texas_hall_variants', 'signed_in_texas_table_states'].includes(scenario.pageLabel)) {
    await enterTexasRoom(page, room);
  }
  await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
  await waitForVariantSplash(page);
  if (['signed_in_texas_controls', 'signed_in_texas_panel_variants'].includes(scenario.pageLabel)) {
    await state.waitForGameConnection(page);
  }
  await handler(page, scenario, proxy, room.roomId, capture);
}

/**
 * 保持原有应用重试行为与加载等待上限。
 * @param page - 当前牌桌页面。
 */
async function waitForVariantSplash(page: Page) {
  await expect.poll(/** 读取加载状态，出现重试入口时点击一次。 */ async () => {
    const retry = visible(page, 'common-alert-button-retry');
    if (await retry.isVisible()) { recordDiagnostic(page, '点击应用重试按钮'); await retry.click(); }
    return !(await visible(page, 'game-splash-screen-bg').isVisible());
  }, { timeout: 90_000, message: '等待德州加载完成，重试 staging 瞬时连接失败' }).toBe(true);
}

/**
 * 连接完成后交给原有截图流程。
 * @param state - 本轮场景资源。
 * @param handler - 牌局或面板截图实现。
 */
async function captureConnected(state: ScenarioCapture, handler: typeof captureGameplay) {
  await state.waitForGameConnection(state.page);
  await handler(state.page, state.scenario, state.proxy, state.room.roomId, state.capture);
}

/**
 * 大厅场景先建立真实观察者连接。
 * @param state - 本轮场景资源。
 */
async function captureHallScenario(state: ScenarioCapture) {
  await enterTexasRoom(state.page, state.room);
  await assertLoaded(state.page);
  await captureHall(state.page, state.scenario, state.proxy, state.room.roomId, state.capture);
}

/**
 * 新版牌谱必须确认真实浏览器入场成功，保留会话断言。
 * @param state - 本轮场景资源。
 */
async function captureRecordScenario(state: ScenarioCapture) {
  await assertLoaded(state.page);
  await expect.poll(state.getRecordEntry,
    { timeout: 30_000, message: '新版牌谱需要本轮真实入房会话' }).toBeDefined();
  const entry = await readRequestJson(state.getRecordEntry()!, 'texas-enter');
  expect(entry.result?.play_session_id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  await captureNewRecords(state.page, state.scenario, state.proxy, state.room.roomId, state.capture);
}

/**
 * 保留大厅和新版牌谱原有加载断言，不添加重试。
 * @param page - 当前牌桌页面。
 */
async function assertLoaded(page: Page) {
  await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
  await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
}

/**
 * 与原场景一致选取最后一个可见控件。
 * @param page - 当前页面。
 * @param id - 控件标识。
 */
function visible(page: Page, id: string) { return page.locator(`[data-testid="${id}"]:visible`).last(); }
