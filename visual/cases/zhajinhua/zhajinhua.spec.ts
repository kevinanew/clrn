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
import { waitForTableConnection } from '../../animations/tableSession';

for (const scenario of buildScenarios().filter(/** 选取炸金花场景，注册牌桌与面板截图用例。
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
      // 连接超时使用自定义 Alert；复用已有的本地化按钮识别及有限重试。
      await waitForTableConnection(page, 'zhajinhua', 'zhajinhua');
      await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
      await expect(visible(page, 'zhajinhua-text-room-name')).toHaveText('TestRoom');
      await expect(visible(page, 'menu-button')).toBeVisible();
      console.log('ZHAJINHUA > 等待牌桌已就绪');
      if (gameplay) {
        await page.clock.pauseAt(await page.evaluate(/** 记录炸金花截图前的页面时刻，固定动画采样位置。 */ () => Date.now()) + 1000);
        await captureGameplay(page, scenario, mitmproxy, room.roomId);
      } else await capturePreGame(page, scenario);
      await diagnostics.save();
    } catch (error) {
      await diagnostics.save(error).catch(/** 记录炸金花诊断附件保存失败，保留原始案例结果。
 * @param failure - 当前操作使用的 failure。 */ failure => console.log(`诊断保存失败：${diagnosticText(failure)}`));
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 }).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
      if (error instanceof Error) { error.message = diagnosticText(error.message); error.stack = diagnosticText(error.stack); }
      throw error;
    } finally {
      try {
        try { if (room) await deletePrivateGameRoom(room); }
        finally { await mitmproxy.release(); }
      } finally { await context.close(); }
    }
  });
}
