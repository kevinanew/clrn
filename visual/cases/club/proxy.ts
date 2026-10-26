/** 为有数据的俱乐部牌局截图启动独立代理，并在用例结束后释放代理进程。 */
import { test as base } from '@playwright/test';
import path from 'node:path';
import type { ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export type ClubRoomProxy = {
  server: string;
  status(): Promise<ProxyStatus & { clubRoomRequests: Record<string, number> }>;
};

export const test = base.extend<{ clubRoomProxy: ClubRoomProxy }>({
  /**
   * 为当前用例启动专用代理，仅此用例的浏览器上下文使用代理地址。
   * @param fixtures - 测试运行器注入的依赖。
   * @param use - 运行使用代理的截图用例。
   */
  clubRoomProxy: async ({}, use) => {
    await withMitmproxy(async proxy => {
      await proxy.stabilizeVisualNetwork();
      await use({
        server: proxy.server,
        /** 读取当前场景的业务接口命中次数。 */
        status: () => proxy.command('status'),
      });
    }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
  },
});
