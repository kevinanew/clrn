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
  test(`texas ${name} animations`, /** 验证当前阶段的德州牌桌动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ browser, mitmproxy }, info) => {
    test.setTimeout(1_200_000);
    try {
      await withTable(browser, info, 'texas', mitmproxy, /** 在已准备的德州牌桌会话中运行当前动画阶段。
 * @param session - 当前操作使用的 session。 */ session => run(session, mitmproxy, info));
    } finally { await mitmproxy.releaseTexas(); }
  });
}

test('texas hall panel animations', /** 验证德州大厅面板动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ browser, mitmproxy }, info) => {
  test.setTimeout(900_000);
  try {
    await mitmproxy.configureHallView();
    await withTable(browser, info, 'texas', mitmproxy, /** 在德州牌桌会话中验证大厅相关动画。
 * @param session - 当前操作使用的 session。 */ session => texasHall(session, mitmproxy, info), true);
  } finally { await mitmproxy.releaseTexas(); }
});
