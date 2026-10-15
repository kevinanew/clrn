import { expect, type Response, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { restore } from '../cases/texas-holdem/replay';
import { events, REPLAY_PLAYER_IDS } from '../cases/texas-holdem/replayData';
import { captureImageFrames } from './imageFrames';
import { captureTimeline } from './timeline';
import type { TableSession } from './tableSession';

/**
 * 通过房间消息触发全部表情、道具及全压火焰，分别验证 JS 飞行轨迹与 WebP 原始帧。
 * @param session - 独立牌桌上下文。
 * @param proxy - 本房间协议回放入口。
 * @param info - 素材及轨迹的报告信息。
 */
export async function texasAssets(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  const loadedAssets = new Map<string, Response>();
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('.webp')) loadedAssets.set(response.url(), response);
  });
  await restore(page, proxy, roomId, self, 'flop', true);
  const images = page.locator('img[src*=".webp"]');
  const captured = new Set<string>();
  for (const [action, names] of [
    ['sticker', ['angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap']],
    ['props', ['tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer']],
  ] as const) {
    for (const name of names) {
      await proxy.replayTexas(roomId, { stream: 'room_message', payload: { action, content: {
        from_user_id: self, to_user_id: REPLAY_PLAYER_IDS[0], file: name,
      } } });
      if (action === 'props') {
        const flying = page.getByTestId('ThrewProp:container');
        await expect(flying).toBeAttached();
        await expect(flying.getByTestId('ThrewProp:image').locator('img')).toBeAttached();
        await captureTimeline(page, info, `prop-${name}-flight`, flying,
          { clip, requireMotion: true, times: [0, 160, 400, 640, 960] });
        await page.clock.runFor(80);
      }
      const effect = images.filter({ visible: true }).last();
      await expect(effect).toBeVisible();
      await expect.poll(() => effect.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const url = await effect.getAttribute('src');
      if (!url) throw new Error('真实效果没有动画素材');
      expect(captured.has(url), `${action}/${name} 必须加载自己的素材，不能复用上一个效果`).toBe(false);
      captured.add(url);
      // 原始素材与视口无关，只解码比较一次；两种视口都验证真实展示及道具飞行。
      if (info.project.name === 'mobile') {
        const absoluteUrl = new URL(url, page.url()).href;
        await captureImageFrames(page, info, `${action}-${name}`, absoluteUrl, loadedAssets.get(absoluteUrl));
      }
      await page.clock.runFor(3200);
    }
  }
  await proxy.replayTexas(roomId, events([{ event: 'all_in', player_id: REPLAY_PLAYER_IDS[0], amount: 960, stack: 0 }]));
  const fire = images.filter({ visible: true }).last();
  await expect(fire).toBeVisible();
  const url = await fire.getAttribute('src');
  if (!url) throw new Error('全压火焰缺少真实素材');
  expect(captured.has(url), '全压必须加载火焰，不能捕获遗留道具').toBe(false);
  if (info.project.name === 'mobile') {
    const absoluteUrl = new URL(url, page.url()).href;
    await captureImageFrames(page, info, 'all-in-fire', absoluteUrl, loadedAssets.get(absoluteUrl));
  }
}
