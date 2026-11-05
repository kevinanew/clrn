/** 俱乐部截图：已加入列表、搜索命中和有数据的牌局分别使用独立代理。 */
import { expect } from '@playwright/test';
import { test } from './proxy';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';
import { runClubSearchResultScenario } from './searchResult';

for (const scenario of buildScenarios().filter(/** 仅保留满足以下条件的条目：`item.group === 'club'`。
 * @param item - 当前遍历的条目。 */ item => item.group === 'club')) {
  if (scenario.pageLabel === 'signed_in_club_populated') {
    test(scenario.label, /** 执行已加入俱乐部列表截图，并核验列表读取确实经过本轮代理。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser, clubListProxy }) => {
      await runVisualScenario(scenario, browser, { network: clubListProxy.network });
      const requests = (await clubListProxy.status()).clubRoomRequests;
      expect(requests['/v10/club'], '已加入列表必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v10/clubs'], '三个俱乐部的资料必须经过本场景代理').toBeGreaterThan(0);
    });
  } else if (scenario.pageLabel === 'signed_in_club_rooms_populated') {
    test(scenario.label, /** 执行俱乐部房间截图，并核验列表及房间资料请求命中代理。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser, clubRoomProxy }) => {
      await runVisualScenario(scenario, browser, { network: clubRoomProxy.network });
      const requests = (await clubRoomProxy.status()).clubRoomRequests;
      expect(requests['/v10/club'], '俱乐部列表必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v10/clubs'], '俱乐部资料必须经过本场景代理').toBeGreaterThan(0);
      expect(requests['/v2/building/rooms'], '牌局列表必须经过本场景代理').toBeGreaterThan(0);
    });
  } else if (scenario.pageLabel === 'signed_in_club_search_result') {
    test(scenario.label, /** 执行当前俱乐部搜索结果场景的截图验证。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser }) => runClubSearchResultScenario(scenario, browser));
  } else {
    test(scenario.label, /** 执行当前俱乐部页面的通用截图场景。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser }) => runVisualScenario(scenario, browser));
  }
}
