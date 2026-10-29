import { bindScenarioProxy } from '../../e2e/helpers/scenario-proxy';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
/** 创建真实牌桌并在清理前保留操作、网络和连接诊断。 */
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../cases/_shared/room';
import { navigate, openApplication, visible } from './appSession';
import { enterTexasRoom } from '../cases/texas-holdem/room';
import { freeze, type CaptureArea } from './timeline';
import { paceNetworkClock } from './networkClock';
import { installConnectionDiagnostics, recordDiagnostic } from '../src/support/connectionDiagnostics';
import { diagnosticNode, diagnosticText } from '../../e2e/helpers/diagnostic-privacy';
import { installCardSpriteDiagnostics, observeCardSpriteClockControl, saveCardSpriteDiagnostics } from './cardSpriteDiagnostics';

export type TableSession = { page: Page; roomId: string; self: string; clip: CaptureArea };

/**
 * 使用真实登录和创建入口建立隔离回放房间，无论断言结果如何都精确清理本轮房间。
 * @param browser - Playwright 浏览器。
 * @param info - 当前用例报告。
 * @param game - 游戏类型。
 * @param proxy - 专用游戏代理地址。
 * @param task - 在真实牌桌执行的动画流程。
 * @param hall - 是否使用大厅显示夹具和本房间观察者连接。
 */
export async function withTable(browser: Browser, info: TestInfo, game: 'texas' | 'zhajinhua',
  proxy: { server: string; network: Mitmproxy; diagnostics?: () => Promise<{ events: unknown[]; dropped: number }> }, task: (session: TableSession) => Promise<void>, hall = false): Promise<void> {
  const viewport = info.project.use.viewport!;
  const context = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1,
    proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
    reducedMotion: 'no-preference' });
  bindScenarioProxy(context, proxy.network);
  const page = await context.newPage();
  let room: RoomSession | undefined;
  const diagnostics = await installConnectionDiagnostics(context, page, info, proxy);
  try {
    if (game === 'texas') await installCardSpriteDiagnostics(page);
    recordDiagnostic(page, '初始化大厅');
    console.log(`TABLE > ${game}/${info.project.name} 初始化大厅`);
    await openApplication(context, page, info, `signed_in_${game}_pre_game`);
    await navigate(page, 'private-room-tab');
    await expect(visible(page, 'create-game-button')).toBeVisible();
    recordDiagnostic(page, '创建本轮房间');
    console.log('TABLE > 从真实入口创建本轮房间');
    room = await createPrivateGameRoom(page, created => {
      room = created;
      recordDiagnostic(page, '建房成功', { roomId: created.roomId, node: diagnosticNode(created.apiOrigin) });
      writeFileSync(info.outputPath('created-room.json'), JSON.stringify({ roomId: created.roomId, apiNode: diagnosticNode(created.apiOrigin) }));
    }, game === 'texas' ? 'texas_react_native' : 'zhajinhua');
    recordDiagnostic(page, '等待牌桌连接及订阅就绪');
    const prefix = game === 'texas' ? 'texas-holdem' : 'zhajinhua';
    if (hall) await enterTexasRoom(page, room);
    else {
      const connection = { state: 'loading' };
      let retries = 0;
      await expect.poll(async () => {
        if (await visible(page, 'common-alert-button-retry').isVisible()) {
          if (retries >= 3) connection.state = 'alert';
          else {
            retries += 1;
            recordDiagnostic(page, '重试牌桌连接', { attempt: retries });
            await visible(page, 'common-alert-button-retry').click();
          }
        } else if (await visible(page, `${prefix}-start-room-timer-button`).isVisible()) connection.state = 'ready';
        return connection.state;
      }, { timeout: 90_000, message: `${game} 牌桌应完成连接或显示应用错误弹窗` }).not.toBe('loading');
      if (connection.state === 'alert') {
        const message = (await page.locator('[data-testid="common-alert-container"]:visible')
          .locator('[data-testid="common-alert-title"], [data-testid="common-alert-message"], [data-testid="common-alert-sub-message"]')
          .allTextContents()).join('；') || '应用显示重试弹窗';
        throw new Error(`${game} 牌桌未就绪，应用提示：${diagnosticText(message)}；详见 connection-summary`);
      }
    }
    await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
    paceNetworkClock(page);
    await freeze(page);
    console.log('TABLE > 牌桌已就绪，开始动画采样');
    const self = await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
    const width = info.project.name === 'mobile' ? 375 : 450;
    recordDiagnostic(page, '牌桌就绪，开始动画采样');
    await task({ page, roomId: room.roomId, self,
      clip: { x: Math.floor((viewport.width - width) / 2), y: 0, width, height: viewport.height } });
    await diagnostics.save();
    await saveCardSpriteDiagnostics(page, info);
  } catch (error) {
    await diagnostics.save(error).catch(failure => console.log(`诊断保存失败：${diagnosticText(failure)}`));
    const overlays = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="screen-mask-touch-to-close"]')).map(mask => ({
      rect: mask.getBoundingClientRect().toJSON(),
      contents: Array.from(mask.parentElement?.querySelectorAll('[data-testid]') || []).map(node => node.getAttribute('data-testid')),
    }))).catch(() => []);
    writeFileSync(info.outputPath('overlays.json'), JSON.stringify(overlays, null, 2));
    await page.screenshot({ path: info.outputPath('failure.png'), timeout: 5000 }).catch(() => undefined);
    // 先保留冻结时钟下的失败，再做诊断性时钟对照；任何恢复都不能改变原始失败。
    await saveCardSpriteDiagnostics(page, info, 'frozen').catch(failure => console.log(`牌面诊断保存失败：${diagnosticText(failure)}`));
    await observeCardSpriteClockControl(page).catch(failure => console.log(`牌面时钟对照失败：${diagnosticText(failure)}`));
    await saveCardSpriteDiagnostics(page, info).catch(failure => console.log(`牌面对照保存失败：${diagnosticText(failure)}`));
    if (error instanceof Error) { error.message = diagnosticText(error.message); error.stack = diagnosticText(error.stack); }
    throw error;
  } finally {
    try { if (room) await deletePrivateGameRoom(room); }
    finally { await context.close(); }
  }
}
