import { test, expect } from '../src/support/diagnosticTest';
import { waitForTableConnection } from '../animations/tableSession';

test('大厅观察者重试真实入口并等待加载遮罩消失', /** 验证大厅无房主按钮时仍可恢复连接并等待完整加载。
 * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
  await page.setContent(`<div data-testid="run-game-view">table</div>
    <div data-testid="game-splash-screen-bg">loading</div>
    <button data-testid="alert-custom-button">Retry</button>`);
  await page.evaluate(/** 模拟一次应用重连，按钮消失后遮罩仍需异步完成。 */ () => {
    document.querySelector('button')!.onclick = /** 点击本轮重试按钮。 */ () => {
      document.querySelector('button')!.remove();
      setTimeout(/** 模拟加载完成。 */ () => document.querySelector('[data-testid="game-splash-screen-bg"]')!.remove(), 200);
    };
  });
  await waitForTableConnection(page, 'texas', 'texas-holdem', true);
  await expect(page.getByTestId('game-splash-screen-bg')).toHaveCount(0);
  await expect(page.getByTestId('texas-holdem-start-room-timer-button')).toHaveCount(0);
});

test('大厅重试上限耗尽仍失败', /** 验证持续连接错误不能被恢复逻辑放行。
 * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
  await page.setContent(`<div data-testid="run-game-view">table</div>
    <div data-testid="game-splash-screen-bg">loading</div>
    <button data-testid="alert-custom-button">Retry</button>`);
  await page.evaluate(/** 仅记录实际点击次数，保持错误弹窗可见。 */ () => {
    let attempts = 0;
    document.querySelector('button')!.onclick = /** 点击本轮重试按钮。 */ () => { document.body.dataset.attempts = String(++attempts); };
  });
  await expect(waitForTableConnection(page, 'texas', 'texas-holdem', true)).rejects.toThrow('牌桌未就绪');
  await expect(page.locator('body')).toHaveAttribute('data-attempts', '3');
  await expect(page.getByTestId('game-splash-screen-bg')).toBeVisible();
});
