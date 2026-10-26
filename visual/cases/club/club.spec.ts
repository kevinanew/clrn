/** 俱乐部截图：搜索命中和有数据的牌局场景分别使用独立代理。 */
import { expect } from '@playwright/test';
import { test } from './proxy';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';
import { runClubSearchResultScenario } from './searchResult';

for (const scenario of buildScenarios().filter(item => item.group === 'club')) {
  if (scenario.pageLabel === 'signed_in_club_rooms_populated') {
    test(scenario.label, async ({ browser, clubRoomProxy }) => {
      await runVisualScenario(scenario, browser, { clubRoomProxyServer: clubRoomProxy.server });
      const requests = (await clubRoomProxy.status()).clubRoomRequests;
      expect(requests['/v10/club'], '俱乐部列表必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v10/clubs'], '俱乐部资料必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v2/building/rooms'], '牌局列表必须经过本场景代理').toBeGreaterThan(0);
    });
  } else if (scenario.pageLabel === 'signed_in_club_search_result') {
    test(scenario.label, async ({ browser }) => runClubSearchResultScenario(scenario, browser));
  } else {
    test(scenario.label, async ({ browser }) => runVisualScenario(scenario, browser));
  }
}
