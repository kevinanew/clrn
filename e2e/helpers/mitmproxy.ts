import { test as base, expect } from '@playwright/test';
import { type Mitmproxy } from './mitmproxy-client';
import { withMitmproxy } from './mitmproxy-session';

export const test = base.extend<{ mitmproxy: Mitmproxy }>({
  /**
   * 为案例提供独立游戏或弱网代理，结束后释放进程及证书目录。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  mitmproxy: async ({}, use) => {
    await withMitmproxy(use);
  },
  /**
   * 为浏览器 fixture 提供本机代理地址，确保本机请求也经过代理。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  proxy: async ({ mitmproxy }, use) => {
    await use({ server: mitmproxy.server, bypass: '<-loopback>' });
  },
  // 仅这些测试上下文忽略证书错误，不修改系统证书信任。
  ignoreHTTPSErrors: true,
});

export { expect };
