import { saveScenarioFailure } from '../texas-holdem/imageFailureDiagnostics';
import { bindScenarioProxy } from '../../../e2e/helpers/scenario-proxy';
/** 真实牌桌视觉回归，失败前保存节点探测和连接诊断。 */
import { installConnectionDiagnostics, recordDiagnostic } from '../../src/support/connectionDiagnostics';
import { diagnosticNode, diagnosticText } from '../../../e2e/helpers/diagnostic-privacy';
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

for (const scenario of buildScenarios().filter(/** 仅保留满足以下条件的条目：`item.group === 'zhajinhua'`。
 * @param item - 当前遍历的条目。 */ item => item.group === 'zhajinhua')) {
  test(scenario.label, /** 创建隔离的炸金花场景上下文，准备房间并执行截图验证。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser, mitmproxy }) => {
    const context = await browser.newContext({
      ...zhajinhuaProxyOptions(mitmproxy), viewport: scenario.viewport,
      locale: 'en-US', deviceScaleFactor: 1,
      storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
    });
    bindScenarioProxy(context, mitmproxy.network);
    const page = await context.newPage();
    const diagnostics = await installConnectionDiagnostics(context, page, test.info(), mitmproxy);
    page.on('pageerror', /** 输出脱敏的炸金花页面运行错误。
 * @param error - 当前操作抛出的错误。 */ error => console.error(`ZHAJINHUA PAGE ERROR > ${diagnosticText(error.message)}`));
    let room: RoomSession | undefined;
    try {
      await setupContextForScenario(context, scenario, page);
      const gameplay = scenario.pageLabel === 'signed_in_zhajinhua_game';
      if (gameplay) await page.clock.install({ time: Date.now() });
      await page.goto(scenario.path);
      console.log('ZHAJINHUA > 页面已加载，准备私人房入口');
      await preparePage(page, scenario);
      const status = await mitmproxy.status();
      expect(status.proxiedRequests).toBeGreaterThan(0);
      console.log(`MITMPROXY > requests=${status.proxiedRequests}, stabilized=${status.stabilizedRequests}`);
      room = await createPrivateGameRoom(page, /** 保存新建炸金花房间的标识与安全诊断，支持中断后的清理核查。
 * @param created - 当前操作使用的 created。 */ created => {
        room = created;
        recordDiagnostic(page, '建房成功', { roomId: created.roomId, node: diagnosticNode(created.apiOrigin) });
        writeFileSync(test.info().outputPath('created-room.json'), JSON.stringify({
          roomId: created.roomId, apiNode: diagnosticNode(created.apiOrigin),
        }));
      }, 'zhajinhua');
      console.log('ZHAJINHUA > 本次私人房创建成功');
      await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect.poll(/** 等待炸金花开局入口，连接失败时点击应用重试按钮。 */ async () => {
        if (await visible(page, 'zhajinhua-start-room-timer-button').isVisible()) return true;
        const retry = visible(page, 'common-alert-button-retry');
        if (await retry.isVisible()) { recordDiagnostic(page, '点击应用重试按钮'); await retry.click(); }
        return false;
      }, { timeout: 90_000, message: '拼三张应完成房间订阅和等待牌桌加载' }).toBe(true);
      await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
      await expect(visible(page, 'zhajinhua-text-room-name')).toHaveText('TestRoom');
      await expect(visible(page, 'menu-button')).toBeVisible();
      console.log('ZHAJINHUA > 等待牌桌已就绪');
      if (gameplay) {
        await page.clock.pauseAt(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()) + 1000);
        await captureGameplay(page, scenario, mitmproxy, room.roomId);
      } else await capturePreGame(page, scenario);
      await diagnostics.save();
    } catch (error) {
      await saveScenarioFailure(page, test.info(), scenario.pageLabel, diagnostics, error, 5000);
      throw error;
    } finally {
      try {
        try { if (room) await deletePrivateGameRoom(room); }
        finally { await mitmproxy.release(); }
      } finally { await context.close(); }
    }
  });
}
