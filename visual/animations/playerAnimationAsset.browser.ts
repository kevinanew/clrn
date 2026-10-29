/** 在真实浏览器验证素材定位及失败边界，不调用真实账号或业务接口。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForPlayerAnimationAsset } from './playerAnimationAsset';

test('素材必须属于目标玩家和当前效果，预加载、旧效果及损坏图片不能代替', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const bitmap = new PNG({ width: 12, height: 12 });
    bitmap.data.fill(255);
    const bytes = PNG.sync.write(bitmap);
    await page.route('https://animation.invalid/**', route => route.request().url().includes('broken')
      ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/png', body: bytes }));
    for (const [category, name, playerId, suffix] of [
      ['stickers', 'angry', 'self', '-operating'], ['props', 'tomato', 'opponent', ''], ['fire', 'fire', 'opponent', '-operating'],
    ] as const) {
      const source = `https://animation.invalid/frames/image/${category}/${name}.current.webp`;
      await page.setContent(`<div data-testid="texas-holdem-player-container-${playerId}${suffix}">
        <img id="target" src="${source}" width="40" height="40">
        <img src="https://animation.invalid/frames/image/${category}/previous.old.webp" width="40" height="40">
      </div><div data-testid="texas-holdem-player-container-other">
        <img src="${source}" width="40" height="40">
      </div><div data-testid="PropImagePreLoader_Container" style="position:absolute;left:-2px;bottom:-2px">
        <img src="${source}" width="1" height="1">
        <img src="https://animation.invalid/frames/image/props/beer.broken.webp" width="1" height="1">
      </div>`);
      const before = await page.evaluate(() => Date.now());
      const image = await waitForPlayerAnimationAsset(page, playerId, category, name);
      assert.equal(await image.getAttribute('id'), 'target', '必须选择当前玩家的真实效果');
      assert.equal(await image.getAttribute('src'), source, '必须选择指定类别和名称的素材');
      assert.equal(await page.evaluate(() => Date.now()), before, '资源就绪检查不得推进动画时刻');
      const previousSelection = page.locator('img[src*=".webp"]').filter({ visible: true }).last();
      assert.match((await previousSelection.getAttribute('src'))!, /beer\.broken/,
        '旧选择器会误选未加载的预加载图片');
      assert.equal(await previousSelection.evaluate((node: HTMLImageElement) => node.naturalWidth), 0);
    }
    await page.locator('#target').evaluate(node => node.remove());
    await assert.rejects(waitForPlayerAnimationAsset(page, 'opponent', 'fire', 'fire'),
      /应在目标玩家位置显示/, '其他玩家和预加载器的同名图片不能掩盖目标缺失');
    await page.setContent(`<div data-testid="texas-holdem-player-container-self">
      <img src="https://animation.invalid/frames/image/stickers/angry.broken.webp" width="40" height="40">
    </div>`);
    await assert.rejects(waitForPlayerAnimationAsset(page, 'self', 'stickers', 'angry'),
      /实际展示图片应完成加载/, '目标素材损坏时仍须失败');
  } finally { await browser.close(); }
});
