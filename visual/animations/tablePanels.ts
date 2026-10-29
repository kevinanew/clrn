import { expect, type Page, type TestInfo } from '@playwright/test';
import { visible, press, pressTarget } from './appSession';
import { exerciseTablePopup as exercisePopup } from './popups';
import { captureTimeline, settleAnimations, type CaptureArea } from './timeline';
import { openRenewPopup } from './renewReadiness';

/**
 * 通过所属弹层的真实遮罩关闭，避免误点其他历史面板。
 * @param page - 当前牌桌。
 * @param marker - 弹层内部标记。
 */
export async function closeTableMask(page: Page, marker: string): Promise<void> {
  await pressTarget(visible(page, marker).locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]')
    .locator(':scope > [data-testid="screen-mask-touch-to-close"]'));
}

const menuPanels = [
  { name: 'card-rank', item: 'card_rank', marker: 'card-rank-list', close: 'card-rank-popup-close' },
  { name: 'theme', item: 'theme', marker: 'game-settings-card-theme-simple', close: 'game-settings-close-button' },
  { name: 'settings', item: 'settings', marker: 'game-settings-popup-container', close: 'game-settings-close-button' },
  { name: 'buy-in', item: 'buy_in', marker: 'buy-in-close-button', close: 'buy-in-close-button' },
  { name: 'renew', item: 'renew', marker: 'renew-popup-close-button', close: 'renew-popup-close-button' },
] as const;

/**
 * 逐一覆盖共享牌桌面板，德州与拼三张分别走自己的实际入口和画面基准。
 * @param page - 当前牌桌。
 * @param info - 当前测试报告。
 * @param game - 游戏名称。
 * @param clip - 固定牌桌画幅。
 */
export async function tablePanels(page: Page, info: TestInfo, game: 'texas' | 'zhajinhua', clip: CaptureArea): Promise<void> {
  if (game === 'zhajinhua') {
    const arrows = page.locator('[data-testid^="seat-guide-"] img').locator('..');
    await expect(arrows).toHaveCount(9);
    // 先跨过循环的大部分区间，接近起点后逐毫秒定位，避免 16 毫秒步长错过基准相位。
    await expect.poll(async () => {
      const offsets = await arrows.evaluateAll(nodes => nodes.map(node =>
        new DOMMatrixReadOnly(getComputedStyle(node).transform).m42));
      if (offsets.length === 9 && offsets.every(offset => Math.abs(offset) < 0.1)) return true;
      await page.clock.runFor(offsets.length === 9 && offsets.every(offset => Math.abs(offset) < 0.5) ? 1 : 16);
      return false;
    }, { timeout: 30_000, intervals: [0], message: '全部空座引导应回到真实循环起点' }).toBe(true);
    await captureTimeline(page, info, 'zhajinhua-seat-guides', arrows,
      { clip, times: [0, 160, 500, 1000, 1500, 2000], requireMotion: true });
  }
  const prefix = game === 'texas' ? 'texas-holdem' : 'zhajinhua';
  await exercisePopup(page, info, { name: `${game}-menu`, target: page.getByTestId('drawer-menu-item-exit'), clip,
    open: /** 点击真实入口。 */ () => press(page, 'menu-button'), close: /** 通过实际按钮或遮罩关闭。 */ () => closeTableMask(page, 'drawer-menu-item-exit') });
  for (const panel of menuPanels) {
    await testStep(info, panel.name, async () => {
      await exercisePopup(page, info, { name: `${game}-${panel.name}`, target: page.getByTestId(panel.marker), clip,
        open: /** 打开菜单后点击对应入口。 */ async () => {
          await press(page, 'menu-button');
          await settleAnimations(page, 1200, true);
          if (panel.name === 'renew') await openRenewPopup(page);
          else await press(page, `drawer-menu-item-${panel.item}`);
        }, close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, panel.close) });
    });
  }
  for (const panel of [
    { name: 'leaderboard', open: game === 'texas' ? `${prefix}-leaderboard-button` : 'zhajinhua-learder-borard-button', marker: 'public-leader-board-container' },
    { name: 'records', open: 'game-record-button', marker: 'review-board-description-text' },
    { name: 'chat', open: `${prefix}-chat-button`, marker: 'in-game-chat-animated-view', close: 'in-game-chat-mask' },
    { name: 'applications', open: 'buy-in-application-button', marker: 'buy-in-application-list' },
  ]) {
    await exercisePopup(page, info, { name: `${game}-${panel.name}`, target: page.getByTestId(panel.marker), clip,
      open: /** 点击真实入口；排行榜完成请求后再采样动画，避免网络快慢决定“加载中”画面。 */ async () => {
        await press(page, panel.open);
        if (panel.name === 'leaderboard') {
          await expect.poll(async () => {
            // 只提交当前时刻的异步任务，不推进弹窗动画的虚拟时间。
            await page.clock.runFor(0);
            return await page.getByTestId('public-leader-board-empty').isVisible()
              || await page.getByTestId('public-leader-board-item-0').isVisible();
          }, { timeout: 30_000, message: '排行榜应显示空数据或首条记录，而不是加载占位' }).toBe(true);
        }
      }, close: /** 通过实际按钮或遮罩关闭。 */ () => panel.close
        ? press(page, panel.close) : closeTableMask(page, panel.marker) });
  }
  await expect(visible(page, 'menu-button')).toBeVisible();
}

/**
 * 在同一房间中记录子流程名称，失败保留对应的准备位置。
 * @param info - 当前报告。
 * @param name - 面板名称。
 * @param task - 面板动画流程。
 */
async function testStep(info: TestInfo, name: string, task: () => Promise<void>): Promise<void> {
  info.annotations.push({ type: 'panel', description: name });
  await task();
}
