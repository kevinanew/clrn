import { writeFileSync } from 'node:fs';
import { test, expect, zhajinhuaProxyOptions } from './proxy';
import { buildScenarios } from '../../scenarios';
import { visualBaseUrl } from '../../target';
import { buildStorageStateForScenario, setupContextForScenario } from '../../src/support/pageSetup';
import { preparePage } from '../../src/support/preparePage';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../_shared/room';
import { visible } from './capture';
import { capturePreGame } from './preGame';
import { captureGameplay } from './gameplay';

for (const scenario of buildScenarios().filter(item => item.group === 'zhajinhua')) {
  test(scenario.label, async ({ browser, mitmproxy }) => {
    const context = await browser.newContext({
      ...zhajinhuaProxyOptions(mitmproxy), viewport: scenario.viewport,
      locale: 'en-US', deviceScaleFactor: 1,
      storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
    });
    const page = await context.newPage();
    page.on('pageerror', error => console.error(`ZHAJINHUA PAGE ERROR > ${error.message}`));
    let room: RoomSession | undefined;
    try {
      await setupContextForScenario(context, scenario, page, { useMitmproxy: true });
      const gameplay = scenario.pageLabel === 'signed_in_zhajinhua_game';
      if (gameplay) await page.clock.install({ time: Date.now() });
      await page.goto(scenario.path);
      console.log('ZHAJINHUA > 页面已加载，准备私人房入口');
      await preparePage(page, scenario);
      const status = await mitmproxy.status();
      expect(status.proxiedRequests).toBeGreaterThan(0);
      console.log(`MITMPROXY > requests=${status.proxiedRequests}, stabilized=${status.stabilizedRequests}`);
      room = await createPrivateGameRoom(page, created => {
        room = created;
        writeFileSync(test.info().outputPath('created-room.json'), JSON.stringify({
          roomId: created.roomId, apiOrigin: created.apiOrigin,
        }));
      }, 'zhajinhua');
      console.log('ZHAJINHUA > 本次私人房创建成功');
      await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => {
        if (await visible(page, 'zhajinhua-start-room-timer-button').isVisible()) return true;
        const retry = visible(page, 'common-alert-button-retry');
        if (await retry.isVisible()) await retry.click();
        return false;
      }, { timeout: 90_000, message: '拼三张应完成房间订阅和等待牌桌加载' }).toBe(true);
      await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
      await expect(visible(page, 'zhajinhua-text-room-name')).toHaveText('TestRoom');
      await expect(visible(page, 'menu-button')).toBeVisible();
      console.log('ZHAJINHUA > 等待牌桌已就绪');
      if (gameplay) {
        await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
        await captureGameplay(page, scenario, mitmproxy, room.roomId);
      } else await capturePreGame(page, scenario);
    } catch (error) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 }).catch(() => undefined);
      throw error;
    } finally {
      try {
        try { if (room) await deletePrivateGameRoom(room); }
        finally { await mitmproxy.release(); }
      } finally { await context.close(); }
    }
  });
}
