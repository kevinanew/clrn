import { test as base, expect, type BrowserContextOptions } from '@playwright/test';
import { type Mitmproxy } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export async function withVisualProxy<T>(task: (proxy: Mitmproxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    return task(proxy);
  });
}

export function visualProxyOptions(proxy: Mitmproxy): BrowserContextOptions {
  return {
    proxy: { server: proxy.server, bypass: '<-loopback>' },
    ignoreHTTPSErrors: true,
  };
}

export const test = base.extend<{ mitmproxy: Mitmproxy }>({
  mitmproxy: async ({}, use) => {
    await withVisualProxy(use);
  },
});

export { expect };
