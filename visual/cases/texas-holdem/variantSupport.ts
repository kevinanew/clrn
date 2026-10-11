import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { events, REPLAY_PLAYER_IDS, restoreTable, type TableOptions } from './replayData';
import { advance, click, visible } from './replay';

export type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

/**
 * 每个视觉分支必须按清单截图，并在结束时确认没有遗漏。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param states - 本分支必须按顺序截取的状态清单。
 * @param capture - 将页面和场景状态保存为截图的回调。
 */
export function sequence(page: Page, scenario: VisualScenario, states: readonly string[], capture: Capture) {
  let index = 0;
  return {
    /**
     * 推进页面动效并按当前场景标签保存指定状态的截图。
     * @param state - 用于截图文件名的场景状态。
     */
    snapshot: async (state: string) => {
      expect(state).toBe(states[index++]);
      await page.clock.runFor(500);
      await capture(page, scenario, state);
    },
    /** 确认本分支已按清单截取全部状态。 */
    done: () => expect(index).toBe(states.length),
  };
}

/**
 * 恢复固定河牌牌桌，并等待真实订阅及五张公共牌显示完成。
 * @param page - 执行操作的 Playwright 页面。
 * @param proxy - 本轮独占的代理控制对象。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 * @param self - 本轮登录玩家的用户 ID。
 * @param options - 本次操作的可选配置。
 * @param opponent - 是否轮到对手操作。
 */
export async function table(page: Page, proxy: TexasProxy, room: string, self: string,
  options: TableOptions = {}, opponent = false) {
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return proxy.replayTexas(room, restoreTable(self, 'river', opponent, options)).then(() => true, () => false);
  }, { timeout: 30_000, message: '等待本房间实际订阅后再发送视觉状态' }).toBe(true);
  await page.clock.runFor(3000);
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return page.locator('[data-testid="community_card_name_text"]').allTextContents();
  }).toEqual(['ah', 'kd', '7c', '2s', 'qs']);
}

/**
 * 切换到对手操作回合，等待预操作按钮显示并确认加注按钮隐藏。
 * @param page - 执行操作的 Playwright 页面。
 * @param proxy - 本轮独占的代理控制对象。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 */
export async function autoButtons(page: Page, proxy: TexasProxy, room: string) {
  await proxy.replayTexas(room, events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
    valid_bets: { call: { amount: 20 } } }]));
  await advance(page);
  await expect(page.getByText(/看或弃|看或棄|Check\/Fold/).last()).toBeVisible();
  await expect(visible(page, 'texas-holdem-operation-button-raise')).toBeHidden();
}

/**
 * 打开游戏菜单并进入指定菜单项。
 * @param page - 执行操作的 Playwright 页面。
 * @param item - 要打开的菜单或设置项标识。
 */
export async function menu(page: Page, item: string) {
  await click(page, 'menu-button');
  await click(page, `drawer-menu-item-${item}`);
}

/**
 * 在游戏设置中启用指定开关，随后关闭设置面板。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export async function enableSetting(page: Page, id: string) {
  await menu(page, 'settings');
  const control = visible(page, `game-settings-switch-${id}`);
  if (!(await control.locator('input[type="checkbox"]').isChecked())) await click(page, `game-settings-switch-${id}`);
  await click(page, 'game-settings-close-button');
}
