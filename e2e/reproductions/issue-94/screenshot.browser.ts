/** 真实 Chromium 验证截图等待逐帧动画及弹窗卸载，不改写动画时间或业务响应。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { screenshotAfterSettling } from './screenshot';

test('截图等待真实弹窗动画完成，保留循环动画', async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-screenshot-settling-'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fixture = pathToFileURL(path.resolve(__dirname, 'fixtures/screenshot-animations.html')).href;
  try {
    await context.test('展开后保持正常尺寸和透明度，循环图标继续播放', async () => {
      await page.goto(fixture);
      await page.locator('#show').click();
      await screenshotAfterSettling(page, path.join(directory, 'opened.png'), { buyIn: 'open' });
      const marker = page.getByTestId('texas-holdem-buy-in-popup-visible-marker');
      assert.equal(await marker.getAttribute('data-opened'), 'true');
      const panel = page.getByTestId('buy-in-title').locator('..');
      assert.equal((await panel.boundingBox())?.width, 300);
      assert.equal(await panel.evaluate(element => getComputedStyle(element).opacity), '1');
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation =>
        animation.playState === 'running' && animation.effect?.getComputedTiming().endTime === Infinity).length), 1);
    });
    await context.test('关闭必须等待节点卸载，透明但仍存在时不能截图', async () => {
      await page.locator('#hide').click();
      await screenshotAfterSettling(page, path.join(directory, 'closed.png'), { buyIn: 'closed' });
      assert.equal(await page.getByTestId('texas-holdem-buy-in-popup-visible-marker').count(), 0);
      assert.equal(await page.locator('body').getAttribute('data-closed'), 'true');
    });
    await context.test('错误弹窗同样等待实际展开动画', async () => {
      await page.locator('#alert').click();
      await screenshotAfterSettling(page, path.join(directory, 'alert.png'), { commonAlert: 'open' });
      assert.equal(await page.getByTestId('common-alert-container').getAttribute('data-opened'), 'true');
      assert.equal((await page.getByTestId('common-alert-message').locator('..').boundingBox())?.width, 300);
    });
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
