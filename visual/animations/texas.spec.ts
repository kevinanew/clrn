import { test } from '../cases/texas-holdem/proxy';
import { withTable } from './tableSession';
import { tablePanels } from './tablePanels';
import { texasGameplay } from './texasGameplay';

import { texasHall } from './texasHall';
import { texasAssets } from './texasAssets';
import { texasSocial } from './texasSocial';

for (const [name, run] of [
  ['panels', /**
   * 运行牌桌面板流程。
   * @param session - 本轮牌桌。
   * @param proxy - 本轮回放代理。
   * @param info - 动画报告。
   */ async (session: Parameters<typeof texasGameplay>[0], proxy: Parameters<typeof texasGameplay>[1], info: Parameters<typeof texasGameplay>[2]) => tablePanels(session.page, info, 'texas', session.clip)],
  ['gameplay', texasGameplay], ['social', texasSocial], ['assets', texasAssets],
] as const) {
  test(`texas ${name} animations`, async ({ browser, mitmproxy }, info) => {
    test.setTimeout(1_200_000);
    try {
      await withTable(browser, info, 'texas', mitmproxy, session => run(session, mitmproxy, info));
    } finally { await mitmproxy.releaseTexas(); }
  });
}

test('texas hall panel animations', async ({ browser, mitmproxy }, info) => {
  test.setTimeout(900_000);
  try {
    await mitmproxy.configureHallView();
    await withTable(browser, info, 'texas', mitmproxy, session => texasHall(session, mitmproxy, info), true);
  } finally { await mitmproxy.releaseTexas(); }
});
