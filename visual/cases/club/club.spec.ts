/** 俱乐部截图：已加入列表、搜索命中和有数据的牌局分别使用独立代理。 */
import { expect } from '@playwright/test';
import { test } from './proxy';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';
import { runClubSearchResultScenario } from './searchResult';

for (const scenario of buildScenarios().filter(item => item.group === 'club')) {
  if (scenario.pageLabel === 'signed_in_club_populated') {
    test(scenario.label, async ({ browser, clubListProxy }) => {
      await runVisualScenario(scenario, browser, { network: clubListProxy.network });
      const requests = (await clubListProxy.status()).clubRoomRequests;
      expect(requests['/v10/club'], '已加入列表必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v10/clubs'], '三个俱乐部的资料必须经过本场景代理').toBeGreaterThan(0);
    });
  } else if (scenario.pageLabel === 'signed_in_club_rooms_populated') {
    test(scenario.label, async ({ browser, clubRoomProxy }) => {
      await runVisualScenario(scenario, browser, { network: clubRoomProxy.network });
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
