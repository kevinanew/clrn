import { test } from '../cases/zhajinhua/proxy';
import { withTable } from './tableSession';
import { tablePanels } from './tablePanels';
import { zhajinhuaGameplay } from './zhajinhuaGameplay';

for (const phase of ['panels', 'gameplay'] as const) {
  test(`zhajinhua ${phase} animations`, async ({ browser, mitmproxy }, info) => {
    test.setTimeout(1_200_000);
    try {
      await withTable(browser, info, 'zhajinhua', mitmproxy, async session => {
        if (phase === 'panels') await tablePanels(session.page, info, 'zhajinhua', session.clip);
        else await zhajinhuaGameplay(session, mitmproxy, info);
      });
    } finally { await mitmproxy.release(); }
  });
}
