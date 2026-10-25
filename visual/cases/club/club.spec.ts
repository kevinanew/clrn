/** 俱乐部截图：普通场景保持既有入口，房间列表有数据场景使用独立代理。 */
import { expect } from '@playwright/test';
import { test } from './proxy';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';

for (const scenario of buildScenarios().filter(item => item.group === 'club')) {
  if (scenario.pageLabel === 'signed_in_club_rooms_populated') {
    test(scenario.label, async ({ browser, clubRoomProxy }) => {
      await runVisualScenario(scenario, browser, { clubRoomProxyServer: clubRoomProxy.server });
      const requests = (await clubRoomProxy.status()).clubRoomRequests;
      expect(requests['/v10/club'], '俱乐部列表必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v10/clubs'], '俱乐部资料必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v2/building/rooms'], '牌局列表必须经过本场景代理').toBeGreaterThan(0);
    });
  } else {
    test(scenario.label, async ({ browser }) => runVisualScenario(scenario, browser));
  }
}
