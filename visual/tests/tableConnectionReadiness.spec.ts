import { test, expect } from '../src/support/diagnosticTest';
import { waitForTableReadiness } from '../animations/tableSession';
import type { Page } from '@playwright/test';

/** 验证大厅连接在原截止时间失败且遮罩仍然可见。
 * @param page - 本地隔离页面。 */
async function expectHallReadinessTimeout(page: Page) {
  const started = performance.now();
  await expect(waitForTableReadiness(page, 'texas', 'texas-holdem', true)).rejects.toThrow(/90000ms/);
  expect(performance.now() - started).toBeGreaterThanOrEqual(89_000);
  expect(performance.now() - started).toBeLessThan(110_000);
  await expect(page.getByTestId('game-splash-screen-bg')).toBeVisible();
}

test('房主重试连接后等待加载遮罩消失', /** 验证原房主重试路径和遮罩等待均保留。
 * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
  await page.setContent(`<div data-testid="run-game-view">table</div>
    <div data-testid="game-splash-screen-bg">loading</div>
    <button data-testid="alert-custom-button">Retry</button>`);
  await page.evaluate(/** 模拟一次应用重连，按钮消失后遮罩仍需异步完成。 */ () => {
    document.querySelector('button')!.onclick = /** 点击本轮重试按钮。 */ () => {
      document.querySelector('button')!.remove();
      const start = document.createElement('button');
      start.dataset.testid = 'texas-holdem-start-room-timer-button';
      document.body.append(start);
      setTimeout(/** 模拟加载完成。 */ () => document.querySelector('[data-testid="game-splash-screen-bg"]')!.remove(), 200);
    };
  });
  await waitForTableReadiness(page, 'texas', 'texas-holdem', false);
  await expect(page.getByTestId('game-splash-screen-bg')).toHaveCount(0);
  await expect(page.getByTestId('texas-holdem-start-room-timer-button')).toBeVisible();
});

test('房主重试上限耗尽仍失败', /** 验证原房主路径保留三次重试上限和失败结果。
 * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
  await page.setContent(`<div data-testid="run-game-view">table</div>
    <div data-testid="game-splash-screen-bg">loading</div>
    <button data-testid="alert-custom-button">Retry</button>`);
  await page.evaluate(/** 仅记录实际点击次数，保持错误弹窗可见。 */ () => {
    let attempts = 0;
    document.querySelector('button')!.onclick = /** 点击本轮重试按钮。 */ () => { document.body.dataset.attempts = String(++attempts); };
  });
  await expect(waitForTableReadiness(page, 'texas', 'texas-holdem', false)).rejects.toThrow('牌桌未就绪');
  await expect(page.locator('body')).toHaveAttribute('data-attempts', '3');
  await expect(page.getByTestId('game-splash-screen-bg')).toBeVisible();
});

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test.describe(`大厅观察者 ${viewport.width}×${viewport.height}`, /** 在实际双视口检查大厅成功和失败结果。 */ () => {
    test.use({ viewport });

    test('遮罩正常消失后就绪，无需房主按钮', /** 观察者只等待加载完成。
     * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
      await page.setContent(`<div data-testid="run-game-view">table</div>
        <div data-testid="game-splash-screen-bg">loading</div>`);
      await page.evaluate(/** 模拟正常异步加载完成。 */ () => {
        setTimeout(/** 移除已完成的加载遮罩。 */ () => document.querySelector('[data-testid="game-splash-screen-bg"]')!.remove(), 200);
      });
      await waitForTableReadiness(page, 'texas', 'texas-holdem', true);
      await expect(page.getByTestId('game-splash-screen-bg')).toHaveCount(0);
      await expect(page.getByTestId('texas-holdem-start-room-timer-button')).toHaveCount(0);
    });

    test('连接需要 Retry 时不点击且在原 90 秒边界失败', /** 真实等待超时，不能自动恢复大厅连接。
     * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
      test.setTimeout(120_000);
      await page.setContent(`<body data-attempts="0"><div data-testid="run-game-view">table</div>
        <div data-testid="game-splash-screen-bg">loading</div>
        <button data-testid="alert-custom-button">Retry</button></body>`);
      await page.evaluate(/** 点击即可恢复，回归必须证明该点击没有发生。 */ () => {
        document.querySelector('button')!.onclick = /** 记录一次恢复并移除遮罩。 */ () => {
          document.body.dataset.attempts = '1';
          document.querySelector('button')!.remove();
          document.querySelector('[data-testid="game-splash-screen-bg"]')!.remove();
        };
      });
      await expectHallReadinessTimeout(page);
      await expect(page.locator('body')).toHaveAttribute('data-attempts', '0');
    });

    test('120 秒才恢复的连接在原 90 秒边界失败', /** 不将晚于原截止时间的加载当成成功。
     * @param fixtures - 本地隔离页面。 */ async ({ page }) => {
      test.setTimeout(120_000);
      await page.setContent(`<div data-testid="run-game-view">table</div>
        <div data-testid="game-splash-screen-bg">loading</div>`);
      await page.evaluate(/** 使用真实页面定时器模拟晚到的连接恢复。 */ () => {
        setTimeout(/** 120 秒后才移除遮罩。 */ () => document.querySelector('[data-testid="game-splash-screen-bg"]')!.remove(), 120_000);
      });
      await expectHallReadinessTimeout(page);
    });
  });
}
