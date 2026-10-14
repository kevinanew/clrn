import { test, expect } from '@playwright/test';
import { buildScenarios } from '../../visual/scenarios';
import { deletePrivateGameRoom, type RoomSession } from '../../visual/cases/_shared/room';
import { withAndroidProxy } from '../proxy';
import { launchApplication, waitForHall } from '../device';
import { selectLanguage, signIn } from '../navigation';
import { captureFailure } from '../diagnostics';
import { createGameRoom, gameSession } from '../game-room';
import { captureGame } from '../game-capture';
import { gamePreGame } from '../game-pregame';
import { texasGameplay } from '../texas-gameplay';
import { zhajinhuaGameplay } from '../zhajinhua-gameplay';

const locale = process.env.ANDROID_LOCALE || 'en';
for (const [suite, game] of [['texas', 'texas-holdem'], ['zhajinhua', 'zhajinhua']] as const) {
  const enabled = ['all', suite].includes(process.env.ANDROID_GROUP || 'all');
  const scenarios = enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: suite })
    .filter(scenario => scenario.viewport.label === 'mobile'
      && [`signed_in_${suite}_pre_game`, `signed_in_${suite}_game`].includes(scenario.pageLabel)) : [];
  for (const scenario of scenarios) {
    test(`${locale} / ${suite} / ${scenario.pageLabel}`, async ({}, testInfo) => {
      test.setTimeout(900_000);
      await withAndroidProxy(async proxy => {
        const device = await launchApplication({ gameDriver: true });
        let room: RoomSession | null = null;
        let index = 0;
        try {
          await waitForHall(device);
          await selectLanguage(device, locale);
          await signIn(device);
          await createGameRoom(device, proxy, game, created => { room = created; });
          await testInfo.attach('created-room', { body: JSON.stringify({ roomId: room!.roomId }), contentType: 'application/json' });
          /**
           * 校验每个状态与 Web 清单的顺序一致。
           * @param state - 共用状态名。
           */
          const capture = async (state: string) => {
            expect(state).toBe(scenario.snapshotStates![index++]);
            await captureGame(device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`, testInfo,
              state === 'statistics_help' ? 'toastText1' : undefined);
          };
          if (scenario.pageLabel.endsWith('_pre_game')) await gamePreGame(device, game, capture);
          else {
            const { account } = await gameSession(proxy);
            expect(account).not.toBeNull();
            await (suite === 'texas' ? texasGameplay : zhajinhuaGameplay)(device, proxy, room!.roomId, account!.userId, capture);
          }
          expect(index).toBe(scenario.snapshotStates!.length);
        } catch (error) {
          await captureFailure(device, testInfo);
          throw error;
        } finally {
          try {
            // 即使创建按钮后的导航失败，也从本轮响应登记中找回房间并清理。
            room ||= (await gameSession(proxy)).room;
            if (room) await deletePrivateGameRoom(room);
          } finally { await device.close(); }
        }
      }, game);
    });
  }
}
