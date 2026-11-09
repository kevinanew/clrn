/** 自动管理应用场景独占的 Python 代理与证书；离线浏览器工具自测继续独立运行。 */
import { test as base, expect } from './diagnostic-test';
import { withMitmproxy } from './mitmproxy-session';
import type { Mitmproxy } from './mitmproxy-client';
import { scenarioBinding } from './scenario-proxy';
import { diagnosticFields } from './diagnostic-privacy';

export const test = base.extend<{ network: Mitmproxy; scenarioBinding: void }>({
  /**
   * 为每例启动默认透传代理。
   * @param fixtures - 测试运行器依赖。
   * @param use - 执行本轮场景。
   * @param info - 当前测试状态与诊断附件出口。
   */
  network: async ({}, use, info) => {
    await withMitmproxy(/** 在代理退出前保存失败现场；不改变场景或请求。
     * @param network - 当前用例的独占代理。
     */ async network => {
      try { await use(network); }
      finally {
        if (info.status !== info.expectedStatus) {
          try {
            const history = await network.command<{ events: unknown[]; dropped: number }>(
              'diagnostics', undefined, 2000);
            await info.attach('proxy-diagnostics', {
              body: JSON.stringify({ dropped: history.dropped, events: history.events.map(diagnosticFields) }),
              contentType: 'application/json',
            });
          } catch { /* 可选取证失败不得覆盖原始测试异常。 */ }
        }
      }
    });
  },
  /**
   * 在浏览器上下文创建前连接代理。
   * @param fixtures - 本轮代理。
   * @param use - 提供 Playwright 代理选项。
   */
  proxy: async ({ network }, use) => { await use({ server: network.server, bypass: '<-loopback>' }); },
  ignoreHTTPSErrors: true,
  scenarioBinding: [scenarioBinding, { auto: true }],
});
export { expect };
