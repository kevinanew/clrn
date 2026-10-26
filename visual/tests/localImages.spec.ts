import { test } from '@playwright/test';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';

test('页面切换后不把已移除图片误判为当前画面的缺图', async ({ page }) => {
  let releaseImage!: () => void;
  const imageResponse = new Promise<void>(resolve => { releaseImage = resolve; });
  await page.route('http://visual.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<img src="/delayed.png" alt="旧画面">' });
      return;
    }
    await imageResponse;
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' }).catch(() => undefined);
  });
  await page.goto('http://visual.test/', { waitUntil: 'domcontentloaded' });

  const checking = ensureLocalImagesLoaded(page);
  await page.waitForFunction(() => Boolean(document.querySelector('img')?.onload));
  await page.evaluate(() => {
    const image = document.querySelector('img')!;
    image.remove();
    image.dispatchEvent(new Event('error'));
  });
  releaseImage();
  await checking;
});
