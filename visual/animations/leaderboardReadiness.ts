import { type Page, type Request } from '@playwright/test';
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
    ].map(async ({ method, path, operation }) => {
      const context = `个人排行榜数据准备失败：method=${method} operation=${operation}`;
      const response = await page.waitForResponse(response => requests.has(response.request())
        && response.request().method() === method && new URL(response.url()).pathname === path,
      { timeout: 15_000 }).catch(() => { throw new Error(`${context} status=未收到响应`); });
      const status = response.status();
      if (!response.ok()) throw new Error(`${context} status=${status}；HTTP 响应失败`);
      const body = await response.json().catch(() => {
        throw new Error(`${context} status=${status}；响应不是有效 JSON`);
      });
      if (body?.ok !== true) throw new Error(`${context} status=${status}；业务结果未成功`);
    });
    // 先安装等待再点击真实入口；不伪造响应，不推进动画相位。
    await Promise.all([...reads, press(page, 'texas-holdem-leaderboard-button')]);
    await page.clock.runFor(0);
  } finally { page.off('request', observe); }
}
