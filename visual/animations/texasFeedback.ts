import { selectScenario, scenarioStatus } from '../../e2e/helpers/scenario-proxy';
import { expect, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { press } from './appSession';
import { captureTimeline, freeze, settleAnimations } from './timeline';
import type { TableSession } from './tableSession';

/**
 * 通过本房间消息和暂缓的设置响应触发提示、加载动画。
 * @param session - 隔离的大厅牌桌。
 * @param proxy - 本房间协议代理。
 * @param info - 时间线报告。
 */
export async function texasFeedback(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, clip } = session;
  await freeze(page);
  await proxy.replayTexas(roomId, { scene: 'texas-feedback-check_community_card' });
  const prompt = page.getByTestId('prompt-item');
  await expect(prompt).toBeAttached();
  await captureTimeline(page, info, 'texas-system-prompt', prompt,
    { clip, times: [0, 80, 160, 320, 1200, 2600], requireMotion: true });
  await expect(prompt).toBeHidden();

  // XHR 的原生 timeout 不受 Playwright JS 时钟控制。仅延长本轮暂缓响应的真实请求，
  // 避免慢机器截图超过 10 秒后被 Axios 的墙钟超时替换为错误弹窗。
  await page.evaluate(id => {
    const state = window as typeof window & { animationXhrOpen?: typeof XMLHttpRequest.prototype.open };
    state.animationXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = new Proxy(state.animationXhrOpen, {
      /**
       * 保留原始请求，仅为当前房间的暂缓请求设置采样所需的网络预算。
       * @param target - 浏览器原始 open 方法。
       * @param xhr - 当前请求实例。
       * @param args - 原始请求参数。
       */
      apply(target, xhr: XMLHttpRequest, args: Parameters<typeof XMLHttpRequest.prototype.open>) {
        const result = Reflect.apply(target, xhr, args);
        const url = new URL(String(args[1]), location.href);
        if (url.pathname.startsWith(`/v10/texas_holdem/room/${id}/user_settings/`)
          && url.pathname.endsWith('auto_rebuy')) {
          xhr.addEventListener('loadstart', () => { xhr.timeout = 120_000; }, { once: true });
        }
        return result;
      },
    });
  }, roomId);
  await selectScenario(page.context(), 'auto-rebuy', { roomId, phase: 'hold' });
  try {
    await press(page, 'auto-rebuy-button');
    await settleAnimations(page, 1200);
    await freeze(page);
    await press(page, 'auto-rebuy-switch');
    await expect.poll(async () => { await page.clock.runFor(16); return (await scenarioStatus(page.context())).requests > 0; }).toBe(true);
    const loading = page.locator('img[src*="icon_loading_circle"]');
    await expect(loading).toBeVisible();
    await captureTimeline(page, info, 'texas-loading-spinner', loading,
      { clip, times: [0, 160, 400, 800, 1200, 1600], requireMotion: true });
    await selectScenario(page.context(), 'auto-rebuy', { roomId, phase: 'release' });
    await expect(loading).toBeHidden();
    await press(page, 'auto-rebuy-close-button');
    await settleAnimations(page, 1200);
  } finally {
    await selectScenario(page.context(), 'auto-rebuy', { roomId, phase: 'release' });
    await page.evaluate(() => {
      const state = window as typeof window & { animationXhrOpen?: typeof XMLHttpRequest.prototype.open };
      if (state.animationXhrOpen) XMLHttpRequest.prototype.open = state.animationXhrOpen;
      delete state.animationXhrOpen;
    });
  }
}
