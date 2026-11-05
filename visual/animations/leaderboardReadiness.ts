import { type Page, type Request } from '@playwright/test';
import { readRequestJson } from '../src/support/requestJson';
import { requestErrorSummary } from '../src/support/requestError';
import { press } from './appSession';

/**
 * 等本次个人排行榜读取完成再采样，避免关闭后遗留请求的错误污染退场画面。
 * @param page - 虚拟时钟已暂停的牌桌页面。
 * @param roomId - 本次真实创建的房间。
 * @param self - 当前真实登录用户。
 */
export async function openPersonalLeaderboard(page: Page, roomId: string, self: string): Promise<void> {
  const requests = new Set<Request>();
  /**
   * 记录本次打开期间发出的请求，旧响应不能作为就绪依据。
   * @param request - 浏览器实际发出的请求。
   */
  const observe = (request: Request) => { requests.add(request); };
  page.on('request', observe);
  try {
    const reads = [
      { method: 'GET', path: `/v10/profile/${self}`, operation: 'leaderboard-profile' },
      { method: 'PUT', path: `/v10/texas_holdem/room/${roomId}/player_statistics`, operation: 'leaderboard-statistics' },
    ].map(/** 等待本次打开排行榜触发的各项读取并验证响应正文。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ method, path, operation }) => {
      const response = await page.waitForResponse(/** 仅匹配本次记录的请求、指定方法和目标路径的排行榜响应。
 * @param response - 当前收到的接口响应。 */ response => requests.has(response.request())
        && response.request().method() === method && new URL(response.url()).pathname === path,
      { timeout: 15_000 }).catch(/** 将排行榜请求错误转成可定位且安全的业务诊断。
 * @param error - 当前操作抛出的错误。 */ error => { throw new Error(requestErrorSummary(error, operation)); });
      await readRequestJson(response, operation);
    });
    // 先安装等待再点击真实入口；不伪造响应，不推进动画相位。
    await Promise.all([...reads, press(page, 'texas-holdem-leaderboard-button')]);
    await page.clock.runFor(0);
  } finally { page.off('request', observe); }
}
