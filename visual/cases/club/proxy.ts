/** 为俱乐部列表和牌局截图启动独立代理，并在用例结束后释放代理进程。 */
import { test as base } from '@playwright/test';
import path from 'node:path';
import type { Mitmproxy, ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';
import { readAuthStateEntries } from '../../src/support/pageSetup';

export type ClubVisualProxy = {
  server: string;
  network: Mitmproxy;
  status(): Promise<Omit<ProxyStatus, 'scenario'> & {
    scenario: 'visual-stable' | 'club-list-populated' | null;
    clubRoomRequests: Record<string, number>;
  }>;
};

export const test = base.extend<{ clubRoomProxy: ClubVisualProxy; clubListProxy: ClubVisualProxy }>({
  /**
   * 将三个虚拟俱乐部限定到本轮真实登录账号，其余场景仍使用原代理。
   * @param fixtures - 测试运行器注入的依赖。
   * @param use - 运行使用代理的截图用例。
   */
  clubListProxy: async ({}, use) => {
    const entries = readAuthStateEntries();
    const userId: unknown = JSON.parse(entries?.['save.user.origin.data.from.server.key'] || '{}').user_id;
    if (typeof userId !== 'string' || !userId) throw new Error('俱乐部列表场景缺少本轮登录账号');
    await withMitmproxy(/** 选择有成员的俱乐部列表场景，并向测试提供代理和命中状态读取。
 * @param proxy - 当前隔离的代理控制器。 */ async proxy => {
      await proxy.command('scenario', { scenario: 'club-list-populated', userId });
      await use({ server: proxy.server, network: proxy,
        /** 读取本轮列表和资料接口的命中次数。 */
        status: () => proxy.command('status') });
    }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
  },
  /**
   * 为当前用例启动专用代理，仅此用例的浏览器上下文使用代理地址。
   * @param fixtures - 测试运行器注入的依赖。
   * @param use - 运行使用代理的截图用例。
   */
  clubRoomProxy: async ({}, use) => {
    await withMitmproxy(/** 启用俱乐部视觉夹具，在代理生命周期内执行房间场景。
 * @param proxy - 当前隔离的代理控制器。 */ async proxy => {
      await proxy.enableVisualFixtures();
      await use({
        server: proxy.server,
        network: proxy,
        /** 读取当前场景的业务接口命中次数。 */
        status: () => proxy.command('status'),
      });
    }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
  },
});
