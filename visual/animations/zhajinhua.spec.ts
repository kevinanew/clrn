import { test } from '../cases/zhajinhua/proxy';
import { withTable } from './tableSession';
import { tablePanels } from './tablePanels';
import { zhajinhuaGameplay } from './zhajinhuaGameplay';

for (const phase of ['panels', 'gameplay'] as const) {
  test(`zhajinhua ${phase} animations`, /** 按当前阶段验证炸金花面板或牌局动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ browser, mitmproxy }, info) => {
    test.setTimeout(1_200_000);
    try {
      await withTable(browser, info, 'zhajinhua', mitmproxy, /** 按当前阶段验证炸金花面板动画或真实牌局动画。
 * @param session - 当前操作使用的 session。 */ async session => {
        if (phase === 'panels') await tablePanels(session.page, info, 'zhajinhua', session.clip);
        else await zhajinhuaGameplay(session, mitmproxy, info);
      });
    } finally { await mitmproxy.release(); }
  });
}
