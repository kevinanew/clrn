/** 自动管理应用场景独占的 Python 代理与证书；离线浏览器工具自测继续独立运行。 */
import { test as base, expect } from '@playwright/test';
import { withMitmproxy } from './mitmproxy-session';
import type { Mitmproxy } from './mitmproxy-client';
import { bindScenarioProxy } from './scenario-proxy';

export const test = base.extend<{ network: Mitmproxy; scenarioBinding: void }>({
  /**
   * 为每例启动默认透传代理。
   * @param fixtures - 测试运行器依赖。
   * @param use - 执行本轮场景。
   */
  network: async ({}, use) => { await withMitmproxy(use); },
  /**
   * 在浏览器上下文创建前连接代理。
   * @param fixtures - 本轮代理。
   * @param use - 提供 Playwright 代理选项。
   */
  proxy: async ({ network }, use) => { await use({ server: network.server, bypass: '<-loopback>' }); },
  ignoreHTTPSErrors: true,
  scenarioBinding: [
    /**
     * 将控制客户端关联到已连接代理的上下文。
     * @param fixtures - 本轮上下文与代理。
     * @param use - 执行场景。
     */
    async ({ context, network }, use) => { bindScenarioProxy(context, network); await use(); },
    { auto: true },
  ],
});
export { expect };
