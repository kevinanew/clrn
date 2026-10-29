import { expect, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { restore } from '../cases/texas-holdem/replay';
import { press } from './appSession';
import { exerciseTablePopup as exercisePopup } from './popups';
import type { TableSession } from './tableSession';
import { texasFeedback } from './texasFeedback';
import { openPersonalLeaderboard } from './leaderboardReadiness';

/**
 * 在本轮私人房连接上使用现有大厅响应夹具，验证大厅专有弹层。
 * @param session - 本轮独立牌桌。
 * @param proxy - 仅影响本轮房间的显示协议夹具。
 * @param info - 动画报告。
 */
export async function texasHall(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  await restore(page, proxy, roomId, self, 'flop', true);
  for (const panel of [
    { name: 'auto-rebuy', open: 'auto-rebuy-button', marker: 'auto-rebuy-popup', close: 'auto-rebuy-close-button' },
    { name: 'pair-play-report', open: 'report-pair-play-button', marker: 'report-pair-play-reason-input', close: 'report-pair-play-close-button' },
    { name: 'personal-leaderboard', open: 'texas-holdem-leaderboard-button', marker: 'personal-leader-board-record-container', close: 'personal-leader-board-close-button' },
  ]) {
    await expect(page.getByTestId(panel.open)).toBeVisible();
    await exercisePopup(page, info, { name: `texas-${panel.name}`, target: page.getByTestId(panel.marker), clip,
      open: /** 个人排行榜等待本次真实读取完成，其他面板沿用原入口。 */ () => panel.name === 'personal-leaderboard'
        ? openPersonalLeaderboard(page, roomId, self) : press(page, panel.open),
      close: /** 关闭面板，不提交修改。 */ () => press(page, panel.close) });
  }
  await texasFeedback(session, proxy, info);
}
