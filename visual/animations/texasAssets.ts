import { expect, type Response, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { restore } from '../cases/texas-holdem/replay';
import { REPLAY_PLAYER_IDS } from '../cases/texas-holdem/replayData';
import { captureImageFrames } from './imageFrames';
import { captureTimeline } from './timeline';
import { waitForPlayerAnimationAsset } from './playerAnimationAsset';
import type { TableSession } from './tableSession';

/**
 * 通过房间消息触发全部表情、道具及全压火焰，分别验证 JS 飞行轨迹与 WebP 原始帧。
 * @param session - 独立牌桌上下文。
 * @param proxy - 本房间协议回放入口。
 * @param info - 素材及轨迹的报告信息。
 */
export async function texasAssets(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self } = session;
  const loadedAssets = new Map<string, Response>();
  page.on('response', /** 保存实际加载的 WebP 响应，供德州动画资源核验。
 * @param response - 当前收到的接口响应。 */ response => {
    if (new URL(response.url()).pathname.endsWith('.webp')) loadedAssets.set(response.url(), response);
  });
  await restore(page, proxy, roomId, self, 'flop', true);
  const captured = new Set<string>();
  for (const [action, names] of [
    ['sticker', ['angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap']],
    ['props', ['tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer']],
  ] as const) {
    for (const name of names) {
      await captureAsset(session, proxy, info, action, name, captured, loadedAssets);
    }
  }
  await captureAllInFire(session, proxy, info, captured, loadedAssets);
}

/**
 * 单独验证每个真实表情或道具的飞行与素材。
 * @param session - 当前牌桌。
 * @param proxy - 隔离代理。
 * @param info - 测试报告。
 * @param action - 协议动作。
 * @param name - 素材名。
 * @param captured - 已捕获资源，防止复用旧素材。
 * @param loadedAssets - 页面真实加载响应。
 */
async function captureAsset(session: TableSession, proxy: TexasProxy, info: TestInfo, action: 'sticker' | 'props', name: string,
  captured: Set<string>, loadedAssets: Map<string, Response>): Promise<void> {
  const { page, roomId, self, clip } = session;
  await proxy.replayTexas(roomId, { scene: 'texas-assets-room_message-@action', parameters: { action: action, file: name } });
  if (action === 'props') {
    const flying = page.getByTestId('ThrewProp:container');
    await expect(flying).toBeAttached();
    await expect(flying.getByTestId('ThrewProp:image').locator('img')).toBeAttached();
    await captureTimeline(page, info, `prop-${name}-flight`, flying,
      { clip, requireMotion: true, times: [0, 160, 400, 640, 960] });
    await page.clock.runFor(80);
  }
  const target = assetTarget(action, self);
  const effect = await waitForPlayerAnimationAsset(page, target.player, target.category, name);
  const url = await assetSource(effect);
  expect(captured.has(url), `${action}/${name} 必须加载自己的素材，不能复用上一个效果`).toBe(false);
  captured.add(url);
  // 原始素材与视口无关，只解码比较一次；两种视口都验证真实展示及道具飞行。
  if (info.project.name === 'mobile') {
    const absoluteUrl = new URL(url, page.url()).href;
    await captureImageFrames(page, info, `${action}-${name}`, absoluteUrl, loadedAssets.get(absoluteUrl));
  }
  await page.clock.runFor(3200);
}

/**
 * 全压火焰保留独立资源断言与手机端逐帧比较。
 * @param session - 当前牌桌。
 * @param proxy - 隔离代理。
 * @param info - 测试报告。
 * @param captured - 已捕获资源。
 * @param loadedAssets - 真实资源响应。
 */
async function captureAllInFire(session: TableSession, proxy: TexasProxy, info: TestInfo,
  captured: Set<string>, loadedAssets: Map<string, Response>): Promise<void> {
  const { page, roomId } = session;
  await proxy.replayTexas(roomId, { scene: 'texas-assets-all_in' });
  const fire = await waitForPlayerAnimationAsset(page, REPLAY_PLAYER_IDS[0], 'fire', 'fire');
  const url = await fire.getAttribute('src');
  if (!url) throw new Error('全压火焰缺少真实素材');
  expect(captured.has(url), '全压必须加载火焰，不能捕获遗留道具').toBe(false);
  if (info.project.name === 'mobile') {
    const absoluteUrl = new URL(url, page.url()).href;
    await captureImageFrames(page, info, 'all-in-fire', absoluteUrl, loadedAssets.get(absoluteUrl));
  }
}

/**
 * 表情展示在本人，道具展示在指定对手，保持原协议归属。
 * @param action - 资源动作。
 * @param self - 当前账号。
 * @returns 玩家及素材类别。
 */
function assetTarget(action: 'sticker' | 'props', self: string) {
  return { player: action === 'sticker' ? self : REPLAY_PLAYER_IDS[0], category: action === 'sticker' ? 'stickers' as const : 'props' as const };
}

/**
 * 真实效果必须提供素材，缺失时保留原错误。
 * @param effect - 真实图片。
 * @returns 实际素材地址。
 */
async function assetSource(effect: import('@playwright/test').Locator): Promise<string> {
  const url = await effect.getAttribute('src');
  if (!url) throw new Error('真实效果没有动画素材');
  return url;
}
