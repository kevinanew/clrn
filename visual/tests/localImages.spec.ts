import { expect, test } from '../src/support/diagnosticTest';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';

test('页面切换后不把已移除图片误判为当前画面的缺图', /** 验证页面切换后不把已移除图片误判为当前画面的缺图。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  let releaseImage!: () => void;
  const imageResponse = new Promise<void>(/** 保存图片响应释放回调，控制被移除图片的迟到响应。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => { releaseImage = resolve; });
  await page.route('http://visual.test/**', /** 提供带延迟图片的页面，在测试放行后返回图片响应。
 * @param route - 当前拦截的网络请求。 */ async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<img src="/delayed.png" alt="旧画面" style="width:20px;height:20px">' });
      return;
    }
    await imageResponse;
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' }).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
  });
  await page.goto('http://visual.test/', { waitUntil: 'domcontentloaded' });

  const checking = ensureLocalImagesLoaded(page);
  await page.evaluate(/** 等待一次浏览器执行往返，让图片等待器有机会安装监听。 */ () => undefined);
  await page.evaluate(/** 移除旧画面的图片并派发失败事件，验证等待不会卡在卸载节点。 */ () => {
    const image = document.querySelector('img')!;
    image.remove();
    image.dispatchEvent(new Event('error'));
  });
  releaseImage();
  await checking;
});

test('等待图片时保留页面原有的加载回调', /** 验证等待图片时保留页面原有的加载回调。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  let releaseImage!: () => void;
  const imageResponse = new Promise<void>(/** 保存图片响应释放回调，控制加载监听回归场景。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => { releaseImage = resolve; });
  const webpImage = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=', 'base64');
  await page.route('http://visual.test/**', /** 提供延迟 WebP 图片，在放行后返回有效图片数据。
 * @param route - 当前拦截的网络请求。 */ async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<img src="/delayed.webp" alt="待加载图片" style="width:20px;height:20px">' });
      return;
    }
    await imageResponse;
    await route.fulfill({ contentType: 'image/webp', body: webpImage });
  });
  await page.goto('http://visual.test/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(/** 安装页面原有图片加载处理器，验证辅助等待不会覆盖业务回调。 */ () => {
    (window as typeof window & { imageLoaded?: boolean }).imageLoaded = false;
    /** 记录页面原有的图片加载回调是否执行。 */
    document.querySelector('img')!.onload = /** 标记页面原有图片加载回调已执行。 */ () => {
      (window as typeof window & { imageLoaded?: boolean }).imageLoaded = true;
    };
  });

  const checking = ensureLocalImagesLoaded(page);
  await page.evaluate(/** 等待一次浏览器执行往返，确保监听已安装后再释放图片响应。 */ () => undefined);
  releaseImage();
  await checking;
  expect(await page.evaluate(/** 读取原图片加载处理器的执行标记，核对等待器没有覆盖业务回调。 */ () => (window as typeof window & { imageLoaded?: boolean }).imageLoaded)).toBe(true);
});

test('隐藏界面的缺图不会阻断当前画面，显示后仍会报错', /** 验证隐藏界面的缺图不会阻断当前画面，显示后仍会报错。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.route('http://visual.test/**', /** 提供带隐藏页面损坏图片的场景，验证不可见图片不阻塞截图。
 * @param route - 当前拦截的网络请求。 */ async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<main>当前画面</main><section style="display:none"><img src="/missing.png" alt="其他界面"></section>' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' });
  });
  await page.goto('http://visual.test/');

  await ensureLocalImagesLoaded(page);
  await page.locator('section').evaluate(/** 显示先前隐藏的图片区域，验证可见性改变后的检查。
 * @param section - 当前操作使用的 section。 */ section => { (section as HTMLElement).style.display = 'block'; });
  await expect(ensureLocalImagesLoaded(page)).rejects.toThrow('本地图片加载失败: /missing.png');
});

test('可见牌面中暂时透明的图集图片也必须成功加载', /** 验证可见牌面中暂时透明的图集图片也必须成功加载。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.route('http://visual.test/**', /** 提供透明牌面图集和损坏资源，验证实际可见牌槽仍需等待图片。
 * @param route - 当前拦截的网络请求。 */ async route => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body:
        '<div data-testid="card-flip" style="width:20px;height:20px">'
        + '<div style="opacity:0"><div data-testid="sprite-image-container" style="width:20px;height:20px">'
        + '<img data-testid="sprite-image-view" src="/missing.png" '
        + 'style="width:20px;height:20px"></div></div></div>' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'image/png', body: '' });
  });
  await page.goto('http://visual.test/');

  await expect(ensureLocalImagesLoaded(page)).rejects.toThrow('本地图片加载失败: /missing.png');
});
