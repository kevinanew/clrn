/** 在真实 Chromium 中核对设置开关的点击、时钟回调和重复执行语义。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { enableGameSettings } from './gameSettings';

for (const assertChecked of [false, true]) {
  test(`设置只切换未勾选项并保留回调顺序：assertChecked=${assertChecked}`, /** 使用离线 DOM 核对真实 checkbox 交互。 */ async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <label data-testid="game-settings-switch-1"><input type="checkbox" checked>One</label>
        <label data-testid="game-settings-switch-2"><input type="checkbox">Two</label>
        <label data-testid="game-settings-switch-3"><input type="checkbox" checked>Three</label>
        <label data-testid="game-settings-switch-4"><input type="checkbox">Four</label>
      `);
      const afterClickStates: boolean[][] = [];
      /** 记录点击后的实际勾选状态，等价于原调用方推进时钟的位置。 */
      const afterClick = async () => {
        afterClickStates.push(await page.locator('input').evaluateAll(/** 读取每个开关的浏览器状态。
         * @param inputs - 当前开关节点。 */ inputs => inputs.map(/** 读取单项勾选状态。
          * @param input - 当前开关。 */ input => (input as HTMLInputElement).checked)));
      };
      await enableGameSettings(page, { afterClick, assertChecked });
      assert.deepEqual(afterClickStates, [[true, true, true, false], [true, true, true, true]]);
      await enableGameSettings(page, { afterClick, assertChecked });
      assert.equal(afterClickStates.length, 2, '再次准备设置不能取消原有勾选或重复推进时钟');
      await page.setContent(`<label data-testid="game-settings-switch-1"><input type="checkbox"></label>`);
      await assert.rejects(enableGameSettings(page, { assertChecked }), /toBeGreaterThanOrEqual/);
    } finally { await browser.close(); }
  });
}
