import type { BrowserContext, Page } from '@playwright/test';

/**
 * 在网络边界隔离匹配的加入、续等和退出，页面不会进入真实玩家的匹配队列。
 * @param context - 当前用例独占上下文。
 * @param page - 创建 WebSocket 前的页面。
 */
export async function mockMatching(context: BrowserContext, page: Page): Promise<void> {
  const paths = ['/v1/hall_matching/join', '/v1/hall_matching/quit', '/v1/hall_matching/keep_waiting'];
  await context.route(url => paths.includes(url.pathname), route => route.fulfill({ json: { ok: true, result: {} } }));
  await page.routeWebSocket('**/*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const forward: string[] = [];
      for (const line of message.toString().split('\n').filter(Boolean)) {
        let frame;
        try { frame = JSON.parse(line); } catch { forward.push(line); continue; }
        if (frame.method === 9 && paths.includes(frame.params?.data?.path)) {
          socket.send(JSON.stringify({ id: frame.id, result: { data: { ok: true, result: {} } } }));
        } else forward.push(line);
      }
      if (forward.length) server.send(forward.join('\n'));
    });
  });
}
