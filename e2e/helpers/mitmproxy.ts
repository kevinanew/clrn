import { test as base, expect } from '@playwright/test';
import { type Mitmproxy } from './mitmproxy-client';
import { withMitmproxy } from './mitmproxy-session';

export const test = base.extend<{ mitmproxy: Mitmproxy }>({
  mitmproxy: async ({}, use) => {
    await withMitmproxy(use);
  },
  proxy: async ({ mitmproxy }, use) => {
    await use({ server: mitmproxy.server, bypass: '<-loopback>' });
  },
  // 仅这些测试上下文忽略证书错误，不修改系统证书信任。
  ignoreHTTPSErrors: true,
});

export { expect };
