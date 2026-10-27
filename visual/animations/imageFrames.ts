import { MAXIMUM_DIFFERENT_PIXEL_RATIO } from '../screenshotComparisonConfiguration';
import { expect, type Page, type Response, type TestInfo } from '@playwright/test';

/**
 * 对真实页面加载的 WebP 逐帧解码比较。图片内部播放不受 JS 时钟控制，独立验证素材帧和帧时长。
 * @param page - 用于获取实际资源和调用浏览器解码器的安全页面。
 * @param info - 当前测试信息。
 * @param name - 不随构建资源哈希变化的效果名称。
 * @param url - 真实组件所引用的动画资源。
 * @param loadedResponse - 优先使用页面刚加载的真实资源响应，避免再次下载同一素材。
 */
export async function captureImageFrames(page: Page, info: TestInfo, name: string, url: string,
  loadedResponse?: Pick<Response, 'ok' | 'body'>): Promise<void> {
  expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  const response = loadedResponse || await page.request.get(url, { timeout: 60_000 });
  expect(response.ok()).toBe(true);
  const bytes = await response.body();
  const frames = await page.evaluate(async encoded => {
    type Decoder = { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
      decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void };
    const Constructor = (globalThis as unknown as { ImageDecoder: new (options: {
      data: Uint8Array; type: string; preferAnimation: boolean;
    }) => Decoder }).ImageDecoder;
    if (!Constructor) throw new Error('当前浏览器不支持动画图片逐帧解码');
    const decoder = new Constructor({ data: Uint8Array.from(atob(encoded), char => char.charCodeAt(0)),
      type: 'image/webp', preferAnimation: true });
    try {
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count < 2 || count > 300) throw new Error(`动画素材帧数异常：${count}`);
      const canvas = document.createElement('canvas');
      const result = [];
      for (let index = 0; index < count; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        canvas.width = image.displayWidth;
        canvas.height = image.displayHeight;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        result.push({ index, timestamp: image.timestamp, duration: image.duration,
          width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] });
        image.close();
      }
      return result;
    } finally { decoder.close(); }
  }, bytes.toString('base64'));
  expect(new Set(frames.map(frame => frame.png)).size, '动画素材必须包含不同图像帧').toBeGreaterThan(1);
  for (const frame of frames) {
    expect(Buffer.from(frame.png, 'base64')).toMatchSnapshot(`asset-${name}-${frame.index}frame.png`,
      { threshold: 0, maxDiffPixelRatio: MAXIMUM_DIFFERENT_PIXEL_RATIO });
  }
  const timing = frames.map(({ png: _png, ...frame }) => frame);
  expect(JSON.stringify(timing, null, 2)).toMatchSnapshot(`asset-${name}-timing.json`);
  await info.attach(`${name}-asset-timing`, { body: JSON.stringify(timing), contentType: 'application/json' });
}
