import { type Page, type Request } from '@playwright/test';
import { readRequestJson } from '../src/support/requestJson';
import { requestErrorSummary } from '../src/support/requestError';
import { press } from './appSession';

/**
 * 等待本次玩家资料、钱包及统计读取成功，再采样弹层，避免默认值或晚到错误污染后续动画。
 * @param page - 虚拟时钟已暂停的牌桌页面。
 * @param player - 本轮回放的虚拟玩家。
 */
export async function openPlayerProfile(page: Page, player: string): Promise<void> {
  const requests = new Set<Request>();
  /**
   * 只接受本次打开后发出的请求，旧响应不能作为就绪依据。
   * @param request - 浏览器实际发出的请求。
   */
  const observe = (request: Request) => { requests.add(request); };
  page.on('request', observe);
  try {
    const reads = [
      { path: `/v10/profile/${player}`, operation: 'player-profile' },
      { path: `/v10/wallet/${player}/currency/coin`, operation: 'player-wallet' },
      { path: `/v1/texas_statistics/player/${player}/rounds/100`, operation: 'player-statistics' },
    ].map(/** 等待本次打开玩家资料触发的各项 GET 读取并校验正文。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ path, operation }) => {
      const response = await page.waitForResponse(/** 仅匹配本次已记录的 GET 请求及指定玩家资料路径。
 * @param response - 当前收到的接口响应。 */ response => requests.has(response.request())
        && response.request().method() === 'GET' && new URL(response.url()).pathname === path,
      { timeout: 15_000 }).catch(/** 将玩家资料读取异常转换为安全、可定位的请求摘要。
 * @param error - 当前操作抛出的错误。 */ error => { throw new Error(requestErrorSummary(error, operation)); });
      await readRequestJson(response, operation);
    });
    // 同时等待三项读取与真实点击；任一读取失败都阻止采样，不推进动画相位。
    await Promise.all([...reads, press(page, `texas-holdem-player-container-${player}`)]);
    await page.clock.runFor(0);
  } finally { page.off('request', observe); }
}
