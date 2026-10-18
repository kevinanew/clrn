import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../cases/_shared/room';
import { navigate, openApplication, visible } from './appSession';
import { enterTexasRoom } from '../cases/texas-holdem/room';
import { freeze, type CaptureArea } from './timeline';

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
  proxy: { server: string }, task: (session: TableSession) => Promise<void>, hall = false): Promise<void> {
  const viewport = info.project.use.viewport!;
  const context = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1,
    proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
    reducedMotion: 'no-preference' });
  const page = await context.newPage();
  let room: RoomSession | undefined;
  try {
    console.log(`TABLE > ${game}/${info.project.name} 初始化大厅`);
    await openApplication(context, page, info, `signed_in_${game}_pre_game`, true);
    await navigate(page, 'private-room-tab');
    await expect(visible(page, 'create-game-button')).toBeVisible();
    console.log('TABLE > 从真实入口创建本轮房间');
    room = await createPrivateGameRoom(page, created => {
      room = created;
      writeFileSync(info.outputPath('created-room.json'), JSON.stringify({ roomId: created.roomId, apiOrigin: created.apiOrigin }));
    }, game === 'texas' ? 'texas_react_native' : 'zhajinhua');
    const prefix = game === 'texas' ? 'texas-holdem' : 'zhajinhua';
    if (hall) await enterTexasRoom(page, room);
    else await expect.poll(async () => {
      if (await visible(page, `${prefix}-start-room-timer-button`).isVisible()) return true;
      const retry = visible(page, 'common-alert-button-retry');
      if (await retry.isVisible()) await retry.click();
      return false;
    }, { timeout: 90_000, message: `${game} 牌桌应完成连接，遇到超时弹窗时重试` }).toBe(true);
    await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
    await freeze(page);
    console.log('TABLE > 牌桌已就绪，开始动画采样');
    const self = await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
    const width = info.project.name === 'mobile' ? 375 : 450;
    await task({ page, roomId: room.roomId, self,
      clip: { x: Math.floor((viewport.width - width) / 2), y: 0, width, height: viewport.height } });
  } catch (error) {
    const overlays = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="screen-mask-touch-to-close"]')).map(mask => ({
      rect: mask.getBoundingClientRect().toJSON(),
      contents: Array.from(mask.parentElement?.querySelectorAll('[data-testid]') || []).map(node => node.getAttribute('data-testid')),
    }))).catch(() => []);
    writeFileSync(info.outputPath('overlays.json'), JSON.stringify(overlays, null, 2));
    await page.screenshot({ path: info.outputPath('failure.png'), timeout: 5000 }).catch(() => undefined);
    throw error;
  } finally {
    try { if (room) await deletePrivateGameRoom(room); }
    finally { await context.close(); }
  }
}
