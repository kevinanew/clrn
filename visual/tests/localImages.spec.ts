import { expect, test } from '@playwright/test';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';

test('页面切换后不把已移除图片误判为当前画面的缺图', async ({ page }) => {
  let releaseImage!: () => void;
  const imageResponse = new Promise<void>(resolve => { releaseImage = resolve; });
  await page.route('http://visual.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<img src="/delayed.png" alt="旧画面" style="width:20px;height:20px">' });
      return;
    }
    await imageResponse;
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' }).catch(() => undefined);
  });
  await page.goto('http://visual.test/', { waitUntil: 'domcontentloaded' });

  const checking = ensureLocalImagesLoaded(page);
  await page.evaluate(() => undefined);
  await page.evaluate(() => {
    const image = document.querySelector('img')!;
    image.remove();
    image.dispatchEvent(new Event('error'));
  });
  releaseImage();
  await checking;
});

test('等待图片时保留页面原有的加载回调', async ({ page }) => {
  let releaseImage!: () => void;
  const imageResponse = new Promise<void>(resolve => { releaseImage = resolve; });
  const webpImage = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=', 'base64');
  await page.route('http://visual.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<img src="/delayed.webp" alt="待加载图片" style="width:20px;height:20px">' });
      return;
    }
    await imageResponse;
    await route.fulfill({ contentType: 'image/webp', body: webpImage });
  });
  await page.goto('http://visual.test/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    (window as typeof window & { imageLoaded?: boolean }).imageLoaded = false;
    /** 记录页面原有的图片加载回调是否执行。 */
    document.querySelector('img')!.onload = () => {
      (window as typeof window & { imageLoaded?: boolean }).imageLoaded = true;
    };
  });

  const checking = ensureLocalImagesLoaded(page);
  await page.evaluate(() => undefined);
  releaseImage();
  await checking;
  expect(await page.evaluate(() => (window as typeof window & { imageLoaded?: boolean }).imageLoaded)).toBe(true);
});

test('隐藏界面的缺图不会阻断当前画面，显示后仍会报错', async ({ page }) => {
  await page.route('http://visual.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<main>当前画面</main><section style="display:none"><img src="/missing.png" alt="其他界面"></section>' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' });
  });
  await page.goto('http://visual.test/');

  await ensureLocalImagesLoaded(page);
  await page.locator('section').evaluate(section => { (section as HTMLElement).style.display = 'block'; });
  await expect(ensureLocalImagesLoaded(page)).rejects.toThrow('本地图片加载失败: /missing.png');
});
