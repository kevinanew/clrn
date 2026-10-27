import { expect, test } from '@playwright/test';
import { openApplication, press, pressTarget } from './appSession';
import { mockSlotMessages } from './slotFixtures';
import { exercisePopup } from './popups';
import { settleAnimations } from './timeline';

test('slot panel and no-energy dialog enter and exit', async ({ context, page }, info) => {
  await context.addInitScript(() => { Math.random = /** 固定背景横幅的随机图标。 */ () => 0.37; });
  const fixture = await mockSlotMessages(page);
  await openApplication(context, page, info);
  fixture.bindUser(await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key')!).user_id));
  const panel = page.getByTestId('slot-machine-view');
  const wallet = panel.getByTestId('top-toolbar');
  const walletNumbers = wallet.getByText(/^\d[\d,]*$/);
  const expectedWalletBalances = { coin: '3,111', diamond: '18' };
  const viewport = page.viewportSize()!;
  const clip = { x: 0, y: 0, ...viewport };
  await exercisePopup(page, info, { name: 'slot-panel', target: panel, clip,
    /** 正式入场开始前确认两个真实数字控件仍在工具栏。 */
    beforeEntrance: async () => {
      await expect(wallet).toBeVisible();
      await expect(walletNumbers, '金币和钻石数字控件必须都存在').toHaveCount(2);
    },
    entranceFinalFrameMask: [walletNumbers],
    /** 完成入场截图后验证异步余额最终来自真实业务状态。 */
    afterEntrance: async () => {
      await expect.poll(async () => {
        await page.clock.runFor(16);
        return Promise.all([
          wallet.getByText(expectedWalletBalances.coin, { exact: true }).isVisible(),
          wallet.getByText(expectedWalletBalances.diamond, { exact: true }).isVisible(),
        ]);
      }, { timeout: 30_000, intervals: [50], message: '老虎机钱包应显示真实的金币和钻石余额' })
        .toEqual([true, true]);
    },
    open: /** 从背景横幅的同一循环起点打开真实老虎机。 */ async () => {
      await page.clock.fastForward(12_000);
      await press(page, 'slot-banner');
    },
    close: /** 关闭老虎机面板。 */ () => pressTarget(panel.getByTestId('close-button')) });
  fixture.exhaustEnergy();
  const dialog = page.getByTestId('slot-no-energy-popup-container');
  await exercisePopup(page, info, { name: 'slot-no-energy', target: dialog, clip,
    requirePresentation: true, excludedBackground: [page.getByTestId('slot-banner')],
    open: /** 从旋转失败响应触发能量不足提示。 */ async () => {
      await page.clock.fastForward(12_000);
      await press(page, 'slot-banner');
      await settleAnimations(page, 1600);
      const previous = fixture.spins;
      await press(page, 'spin-button');
      await expect.poll(async () => { await page.clock.runFor(0); return fixture.spins; }).toBe(previous + 1);
      // exercisePopup 按真实挂载逐帧推进，不能在入场采样前固定跳过 500ms。
    }, close: /** 点击提示的确认按钮。 */ () => pressTarget(dialog.getByTestId('confirm-button')) });
});
