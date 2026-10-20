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
  const viewport = page.viewportSize()!;
  const clip = { x: 0, y: 0, ...viewport };
  await exercisePopup(page, info, { name: 'slot-panel', target: panel, clip,
    open: /** 从背景横幅的同一循环起点打开真实老虎机。 */ async () => {
      await page.clock.fastForward(12_000);
      await press(page, 'slot-banner');
    },
    close: /** 关闭老虎机面板。 */ () => pressTarget(panel.getByTestId('close-button')) });
  fixture.exhaustEnergy();
  const dialog = page.getByTestId('slot-no-energy-popup-container');
  await exercisePopup(page, info, { name: 'slot-no-energy', target: dialog, clip,
    open: /** 从旋转失败响应触发能量不足提示。 */ async () => {
      await page.clock.fastForward(12_000);
      await press(page, 'slot-banner');
      await settleAnimations(page, 1600);
      const previous = fixture.spins;
      await press(page, 'spin-button');
      await expect.poll(async () => { await page.clock.runFor(0); return fixture.spins; }).toBe(previous + 1);
      await page.clock.runFor(16);
      // 应用在老虎机关闭后延迟 500ms 打开提示。
      await page.clock.runFor(500);
    }, close: /** 点击提示的确认按钮。 */ () => pressTarget(dialog.getByTestId('confirm-button')) });
});
