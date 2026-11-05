/** 在真实浏览器验证素材定位及失败边界，不调用真实账号或业务接口。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForPlayerAnimationAsset } from './playerAnimationAsset';

/**
 * 为两种资源就绪回归准备同一暂停时钟与真实 PNG 字节。
 * @param browser - 由调用方负责关闭的浏览器。
 */
async function frozenAssetPage(browser: Browser) {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  const bitmap = new PNG({ width: 12, height: 12 });
  bitmap.data.fill(255);
  return { page, bytes: PNG.sync.write(bitmap) };
}

test('慢速素材超过动画断言时限后仍等待真实图片，且不推进动画', /** 验证慢速素材超过动画断言时限后仍等待真实图片，且不推进动画。 */ async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const { page, bytes } = await frozenAssetPage(browser);
    await page.setContent(`<div data-testid="texas-holdem-player-container-self">
      <img src="data:image/png;base64,#/frames/image/stickers/smirk.current.webp" width="40" height="40">
    </div>`, { waitUntil: 'domcontentloaded' });
    const before = await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
    const source = `data:image/png;base64,${bytes.toString('base64')}#/frames/image/stickers/smirk.current.webp`;
    const [image] = await Promise.all([
      waitForPlayerAnimationAsset(page, 'self', 'stickers', 'smirk'),
      delay(16_000).then(/** 将异步结果转换为`page.locator('img').evaluate((node: HTMLImageElement, value) => { node.src = value; }, source)`，供后续步骤使用。 */ () => page.locator('img').evaluate(/** 替换目标图片地址，触发动画资源的重新加载。
 * @param node - 当前遍历的 DOM 或语法节点。
 * @param value - 当前待转换或校验的值。 */ (node: HTMLImageElement, value) => { node.src = value; }, source)),
    ]);
    assert.equal(await image.evaluate(/** 在页面中读取`node.naturalWidth`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ (node: HTMLImageElement) => node.naturalWidth), 12);
    assert.equal(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()), before);
  } finally { await browser.close(); }
});

test('素材必须属于目标玩家和当前效果，预加载、旧效果及损坏图片不能代替', /** 验证素材必须属于目标玩家和当前效果，预加载、旧效果及损坏图片不能代替。 */ async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const { page, bytes } = await frozenAssetPage(browser);
    await page.route('https://animation.invalid/**', /** 对损坏资源返回 404，其余返回有效图片字节。
 * @param route - 当前拦截的网络请求。 */ route => route.request().url().includes('broken')
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
      const before = await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
      const image = await waitForPlayerAnimationAsset(page, playerId, category, name);
      assert.equal(await image.getAttribute('id'), 'target', '必须选择当前玩家的真实效果');
      assert.equal(await image.getAttribute('src'), source, '必须选择指定类别和名称的素材');
      assert.equal(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()), before, '资源就绪检查不得推进动画时刻');
      const previousSelection = page.locator('img[src*=".webp"]').filter({ visible: true }).last();
      assert.match((await previousSelection.getAttribute('src'))!, /beer\.broken/,
        '旧选择器会误选未加载的预加载图片');
      assert.equal(await previousSelection.evaluate(/** 在页面中读取`node.naturalWidth`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ (node: HTMLImageElement) => node.naturalWidth), 0);
    }
    await page.locator('#target').evaluate(/** 在页面中读取`node.remove()`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.remove());
    await assert.rejects(waitForPlayerAnimationAsset(page, 'opponent', 'fire', 'fire'),
      /应在目标玩家位置显示/, '其他玩家和预加载器的同名图片不能掩盖目标缺失');
    await page.setContent(`<div data-testid="texas-holdem-player-container-self">
      <img src="https://animation.invalid/frames/image/stickers/angry.broken.webp" width="40" height="40">
    </div>`);
    await assert.rejects(waitForPlayerAnimationAsset(page, 'self', 'stickers', 'angry'),
      /实际展示图片应完成加载/, '目标素材损坏时仍须失败');
  } finally { await browser.close(); }
});
