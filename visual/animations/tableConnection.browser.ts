/** 离线验证牌桌连接弹窗恢复及重试上限。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { waitForTableConnection } from './tableSession';

test('识别两种连接重试按钮，恢复后才就绪，持续失败最多点击三次', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const cases = ['common-alert-button-retry', 'alert-custom-button']
      .flatMap(id => [false, true].map(persistent => ({ id, persistent })));
    for (const { id, persistent } of cases) {
      await page.setContent(`<div data-testid="common-alert-container">
        <span data-testid="common-alert-message">timeout of 10000ms exceeded</span>
        <button data-testid="alert-custom-button">Cancel</button>
        <button id="retry" data-testid="${id}">Retry</button></div><output>0</output>`);
      await page.evaluate(persistent => {
        document.querySelector('#retry')!.addEventListener('click', () => {
          const output = document.querySelector('output')!;
          output.textContent = String(Number(output.textContent) + 1);
          if (!persistent) {
            document.querySelector('div')!.remove();
            const ready = document.createElement('button');
            ready.dataset.testid = 'texas-holdem-start-room-timer-button';
            document.body.append(ready);
          }
        });
      }, persistent);
      const waiting = waitForTableConnection(page, 'texas', 'texas-holdem');
      if (persistent) await assert.rejects(waiting, /牌桌未就绪，应用提示/);
      else await waiting;
      assert.equal(await page.locator('output').textContent(), persistent ? '3' : '1');
    }
  } finally { await browser.close(); }
});
