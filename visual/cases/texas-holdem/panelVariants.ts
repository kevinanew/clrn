import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { PANEL_VARIANT_STATES } from './scenarios';
import { advance, click, closeMask, freezeClock, restore, selfId, visible } from './replay';
import { enableSetting, sequence, table, type Capture } from './variantSupport';

/**
 * 截取德州面板的数据、权限及错误提示分支。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param proxy - 本轮独占的代理控制对象。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 * @param capture - 将页面和场景状态保存为截图的回调。
 */
export async function capturePanelVariants(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  room: string, capture: Capture) {
  const self = await selfId(page);
  await freezeClock(page);
  await table(page, proxy, room, self);
  const { snapshot, done } = sequence(page, scenario, PANEL_VARIANT_STATES, capture);
  for (const mode of ['pending', 'resolved', 'more'] as const) {
    await proxy.configureUI({ applications: mode });
    await click(page, 'buy-in-application-button');
    await assertApplicationMode(page, mode);
    await snapshot(`applications_${mode}`);
    await closeMask(page, 'buy-in-application-list');
  }
  await enableSetting(page, 'player-voice');
  await proxy.replayTexas(room, { scene: 'panel-variants-room_message-audio' });
  await advance(page);
  await click(page, 'texas-holdem-chat-button');
  await click(page, '-in-game-chat-record-tab');
  await expect(visible(page, 'in-game-chat-audio-message-0')).toBeVisible();
  await snapshot('chat_audio_history');
  const barrageSwitch = visible(page, 'in-game-chat-barrage-switch');
  // 聊天弹幕开关用图片按钮呈现，初始为开启；点击后应切换到关闭图标。
  const barrageIcon = barrageSwitch.locator('img');
  const enabledIcon = await barrageIcon.getAttribute('src');
  expect(enabledIcon).toBeTruthy();
  await click(page, 'in-game-chat-barrage-switch');
  await expect(barrageIcon).not.toHaveAttribute('src', enabledIcon!);
  await snapshot('chat_barrage_off');
  await click(page, 'in-game-chat-mask');
  await proxy.configureUI({ rpcError: 'retry' });
  await click(page, 'texas-holdem-operation-button-call');
  await expect(visible(page, 'common-alert-message')).toContainText('Please retry');
  await snapshot('alert_retry');
  await page.getByText(/取消|Cancel/i, { exact: true }).last().click();
  await advance(page);
  await restore(page, proxy, room, self, 'flop', true);
  await proxy.configureUI({ rpcError: 'balance' });
  await proxy.replayTexas(room, { scene: 'panel-variants-settlement' });
  await advance(page);
  await click(page, 'texas-holdem-show-remain-community-card-button');
  await expect(visible(page, 'common-alert-button-go_to_mall')).toBeVisible();
  await snapshot('alert_insufficient_balance');
  await click(page, 'common-alert-button-cancel');
  await proxy.configureUI({ rpcError: 'auth' });
  await proxy.replayTexas(room, { scene: 'hall-new_game' });
  await advance(page);
  await table(page, proxy, room, self);
  await expect(visible(page, 'texas-holdem-show-hand-card-button')).toBeHidden();
  await expect(visible(page, 'texas-holdem-show-remain-community-card-button')).toBeHidden();
  await click(page, 'texas-holdem-operation-button-call');
  await expect(visible(page, 'common-alert-button-quit')).toBeVisible();
  await expect(visible(page, 'common-alert-title')).toHaveText({
    'zh-Hans': '身份验证失败', 'zh-Hant': '身份驗證失敗', en: 'Authentication failed',
  }[scenario.locale]);
  await snapshot('alert_authentication_failed');
  done();
}

/**
 * 按具名状态断言申请人数和相应控件。
 * @param page - 当前牌桌页面。
 * @param mode - 固定申请状态。
 */
async function assertApplicationMode(page: Page, mode: 'pending' | 'resolved' | 'more') {
  const cases = {
    pending: { count: 2, selector: 'buy-in-approved-applications-tab', expected: 2 },
    resolved: { count: 3, selector: 'buy-in-application-status', expected: 3 },
    more: { count: 2, selector: 'buy-in-application-list-more', expected: undefined },
  };
  const entry = cases[mode];
  await expect(page.locator('[data-testid="buy-in-application-nickname"]:visible')).toHaveCount(entry.count);
  if (entry.expected === undefined) await expect(visible(page, entry.selector)).not.toHaveAttribute('aria-disabled', 'true');
  else await expect(page.locator(`[data-testid="${entry.selector}"]:visible`)).toHaveCount(entry.expected);
}
