import { test as base, expect } from '@playwright/test';
import { buildScenarios } from '../../visual/scenarios';
import { deletePrivateGameRoom, type RoomSession } from '../../visual/cases/_shared/room';
import { withAndroidProxy } from '../proxy';
import { launchApplication, waitForHall } from '../device';
import { selectLanguage, signIn } from '../navigation';
import { captureFailure } from '../diagnostics';
import { createGameRoom, gameSession } from '../game-room';
import { captureGame } from '../game-capture';
import { gamePreGame } from '../game-pregame';
import { runTexasScenario } from '../texas-flows';
import { zhajinhuaGameplay } from '../zhajinhua-gameplay';
import type { ScreenshotMask } from '../screenshot';

const test = base.extend<{ ownedRoom: { value: RoomSession | null } }>({
  /**
   * 独立于用例正文的收尾阶段，确保整例超时后仍清理已登记房间。
   * @param use - 将本轮房间登记容器交给用例，并等待框架进入收尾阶段。
   */
  ownedRoom: async ({}, use) => {
    const ownedRoom: { value: RoomSession | null } = { value: null };
    try { await use(ownedRoom); }
    finally { if (ownedRoom.value) await deletePrivateGameRoom(ownedRoom.value); }
  },
});

const locale = process.env.ANDROID_LOCALE || 'en';
for (const [suite, game] of [['texas', 'texas-holdem'], ['zhajinhua', 'zhajinhua']] as const) {
  const enabled = ['all', suite].includes(process.env.ANDROID_GROUP || 'all');
  const scenarios = enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: suite })
    .filter(scenario => scenario.viewport.label === 'mobile') : [];
  for (const scenario of scenarios) {
    test(`${locale} / ${suite} / ${scenario.pageLabel}`, async ({ ownedRoom }, testInfo) => {
      test.setTimeout(1_200_000);
      await withAndroidProxy(async proxy => {
        if (scenario.pageLabel === 'signed_in_texas_records_v2') await proxy.command('texas/records', { empty: true });
        const device = await launchApplication({ gameDriver: true });
        let room: RoomSession | null = null;
        let index = 0;
        try {
          await waitForHall(device);
          await selectLanguage(device, locale);
          await signIn(device);
          const hall = ['signed_in_texas_hall', 'signed_in_texas_hall_variants'].includes(scenario.pageLabel);
          const guest = scenario.pageLabel === 'signed_in_texas_table_states';
          if (hall || guest) await proxy.command('texas/view', { mode: hall ? 'hall' : 'guest' });
          await createGameRoom(device, proxy, game, created => { room = created; ownedRoom.value = created; },
            scenario.pageLabel === 'signed_in_texas_optional_pre_game', hall || guest);
          await testInfo.attach('created-room', { body: JSON.stringify({ roomId: room!.roomId }), contentType: 'application/json' });
          /**
           * 校验每个状态与 Web 清单的顺序一致。
           * @param state - 共用状态名。
           * @param masks - 已从真实输入框检测的光标区域。
           * @param triggerToast - 遮罩准备完成后才点击触发短时提示。
           */
          const capture = async (state: string, masks: ScreenshotMask[] = [], triggerToast?: () => Promise<string | void>) => {
            expect(state).toBe(scenario.snapshotStates![index++]);
            console.log(`ANDROID > ${suite} 截图状态 ${state}`);
            const transient = ['statistics_help', 'accurate_raise_minimum_error'].includes(state) ? 'toastText1'
              : ['prediction_result', 'prediction_loss', 'prediction_diamond'].includes(state) ? 'bet-next-hand-result-amount'
                : state === 'level_up' ? 'level-up-title'
                  : state === 'remaining_cards' ? 'view-community-cards-countdown' : undefined;
            const expectedAlerts: Record<string, string> = {
              quit_confirm: 'common-alert-button-quit', alert_retry: 'common-alert-message',
              alert_insufficient_balance: 'common-alert-button-go_to_mall', alert_authentication_failed: 'common-alert-button-quit',
              delay_cooldown_alert: 'common-alert-message',
            };
            await captureGame(device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`, testInfo,
              transient, expectedAlerts[state], masks, triggerToast);
          };
          const { account } = await gameSession(proxy);
          expect(account).not.toBeNull();
          if (suite === 'texas') await runTexasScenario(scenario.pageLabel,
            { device, proxy, room: room!.roomId, self: account!.userId, capture });
          else if (scenario.pageLabel.endsWith('_pre_game')) await gamePreGame(device, game, capture);
          else await zhajinhuaGameplay(device, proxy, room!.roomId, account!.userId, capture);
          expect(index).toBe(scenario.snapshotStates!.length);
        } catch (error) {
          await captureFailure(device, testInfo);
          throw error;
        } finally {
          try {
            // 即使创建按钮后的导航失败，也从本轮响应登记中找回房间并清理。
            room ||= (await gameSession(proxy)).room;
            ownedRoom.value ||= room;
          } finally { await device.close(); }
        }
      }, game);
    });
  }
}
