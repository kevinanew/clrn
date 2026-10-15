import { expect, type TestInfo } from '@playwright/test';
import type { ZhajinhuaProxy } from '../cases/zhajinhua/proxy';
import { events, restoreTable, validBets } from '../cases/zhajinhua/replayData';
import { press } from './appSession';
import { captureTimeline } from './timeline';
import type { TableSession } from './tableSession';

/**
 * 验证拼三张独立实现的玩家倒计时、经验和升级进退场。
 * @param session - 本轮隔离牌桌。
 * @param proxy - 只绑定本轮房间的消息及响应夹具。
 * @param info - 关键帧报告。
 */
export async function zhajinhuaFeedback(session: TableSession, proxy: ZhajinhuaProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  await proxy.replay(roomId, events(restoreTable(self).queue.map(item =>
    item.event === 'room_status' || item.event === 'game_status'
      ? { ...item, status: { ...(item.status as Record<string, unknown>), operating_seconds: 12 } } : item)));
  const countdown = page.getByTestId(`zhajinhua-player-container-${self}-operating`).getByTestId('zhajinhua-active-countdown');
  await expect(countdown).toHaveText('120');
  await expect(page.getByTestId('countdown-text')).toHaveAttribute('data-seconds', '3600');
  await page.clock.runFor(3200);
  await proxy.replay(roomId, events([{ event: 'switch_player', player_id: self, valid_bets: validBets(false) }]));
  await expect(countdown).toContainText('12');
  await captureTimeline(page, info, 'zhajinhua-countdown', countdown,
    { clip, times: [0, 1000, 3000, 6000, 9000, 11000] });
  await proxy.replay(roomId, restoreTable(self, false, true));
  await expect(countdown).toHaveText('120');
  await expect(page.getByTestId('countdown-text')).toHaveAttribute('data-seconds', '3600');
  await page.clock.runFor(3200);
  await proxy.operationReward(roomId, true);
  try {
    await press(page, 'zhajinhua-operation-button-call');
    const title = page.getByTestId('zhajinhua-level-up-level-text');
    await expect.poll(async () => {
      await page.clock.runFor(16);
      return title.textContent();
    }).toContain('6');
    await captureTimeline(page, info, 'zhajinhua-experience-level-up', title,
      { clip, times: [0, 80, 160, 320, 1000, 4800, 5200, 5600] });
    await expect(title).not.toBeInViewport();
  } finally { await proxy.operationReward(roomId, false); }
}
