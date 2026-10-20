import { expect, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { restore } from '../cases/texas-holdem/replay';
import { REPLAY_PLAYER_IDS } from '../cases/texas-holdem/replayData';
import { enableSetting } from '../cases/texas-holdem/variantSupport';
import { press, pressTarget, visible } from './appSession';
import { exerciseTablePopup as exercisePopup } from './popups';
import { closeTableMask } from './tablePanels';
import { captureTimeline, freeze } from './timeline';
import type { TableSession } from './tableSession';

/**
 * 从真实房间消息和按钮触发聊天、语音、举报、屏蔽及带入审核弹层。
 * @param session - 本轮创建并隔离的牌桌。
 * @param proxy - 房间消息回放边界。
 * @param info - 动画报告与截图命名上下文。
 */
export async function texasSocial(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  await restore(page, proxy, roomId, self, 'flop', true);
  await page.evaluate(() => { Math.random = /** 固定弹幕纵坐标的随机输入。 */ () => 0.37; });
  await proxy.replayTexas(roomId, { stream: 'room_message', payload: { action: 'text', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', text: 'Good hand!',
  } } });
  await expect(page.getByTestId('barrage_text')).toHaveText('Player1: Good hand!');
  await captureTimeline(page, info, 'texas-barrage', page.getByTestId('barrage_container'),
    { clip, times: [0, 500, 1500, 2500, 4000, 5200] });
  await press(page, 'texas-holdem-chat-button');
  await page.clock.runFor(1200);
  await press(page, '-in-game-chat-record-tab');
  await page.clock.runFor(320);
  await expect(visible(page, 'in-game-chat-text-message-0')).toContainText('Good hand!');
  await exercisePopup(page, info, { name: 'texas-message-actions', target: page.getByTestId('report_cancel_button'), clip, exitAnimated: false,
    open: /** 打开消息操作菜单。 */ () => press(page, 'in-game-chat-report-button-0'),
    close: /** 取消消息菜单。 */ () => press(page, 'report_cancel_button') });
  for (const action of [
    { name: 'report', button: 'report_item_report', marker: 'report-popup-title' },
    { name: 'block', button: 'report_item_block', marker: 'BlockPlayerConfirmPopup:title', close: 'BlockPlayerConfirmPopup:cancelButton' },
  ]) {
    await exercisePopup(page, info, { name: `texas-message-${action.name}`, target: page.getByTestId(action.marker), clip,
      open: /** 经消息菜单打开确认面板。 */ async () => {
        await press(page, 'in-game-chat-report-button-0');
        await page.clock.runFor(400);
        await press(page, action.button);
      },
      close: /** 取消业务操作并关闭面板。 */ () => action.close ? press(page, action.close) : closeTableMask(page, action.marker) });
  }
  await press(page, 'in-game-chat-mask');
  await page.clock.runFor(1200);
  await enableSetting(page, 'player-voice');
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
  });
  await exercisePopup(page, info, { name: 'texas-voice', target: page.getByTestId('in-game-audio-microphone-button'), clip,
    open: /** 等待真实麦克风权限检查和面板挂载，再从固定时刻推进动画。 */ async () => {
      await press(page, 'texas-holdem-voice-button');
      await expect(page.getByTestId('in-game-audio-microphone-button')).toBeAttached();
    },
    close: /** 关闭语音面板。 */ () => press(page, 'in-game-audio-popup-close') });
  await exercisePopup(page, info, { name: 'texas-buy-in-review', target: page.getByTestId('buy-in-review-close-button'), clip,
    open: /** 回放本房间的固定带入申请。 */ () => proxy.replayTexas(roomId,
      { stream: 'buy_in', payload: { action: 'apply_buy_in', content: {
        application_id: 'visual-application', user_id: REPLAY_PLAYER_IDS[1],
        user_nickname: 'Player2', nickname: 'Player2', amount: 500,
      } } }),
    close: /** 关闭审核面板，不批准申请。 */ () => press(page, 'buy-in-review-close-button') });
  await freeze(page);
  await restore(page, proxy, roomId, self, 'river');
  await proxy.configureUI({ rpcError: 'retry' });
  await exercisePopup(page, info, { name: 'texas-common-alert', target: page.getByTestId('common-alert-message'), clip,
    open: /** 取消错误提示后操作区保持收起，每轮先恢复真实操作状态。 */ async () => {
      await restore(page, proxy, roomId, self, 'river');
      await press(page, 'texas-holdem-operation-button-call');
    },
    close: /** 错误响应未提供 buttonId，通过实际按钮文字取消。 */ () => pressTarget(page.getByTestId('common-alert-button-undefined').filter({ hasText: 'Cancel' })) });
  await proxy.configureUI({ rpcError: null });
}
