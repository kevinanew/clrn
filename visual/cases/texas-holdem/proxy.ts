import { test as base, expect as playwrightExpect, type BrowserContextOptions } from '@playwright/test';
import path from 'node:path';
import { type Mitmproxy, type ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export class TexasProxy {
  constructor(private readonly proxy: Mitmproxy) {}
  get server(): string { return this.proxy.server; }
  status(): Promise<ProxyStatus & { replayedMessages: number }> {
    return this.proxy.command('status');
  }
  replayTexas(roomId: string, data: unknown): Promise<ProxyStatus> {
    return this.proxy.command('texas/replay', { roomId, data });
  }
  configureHallView(): Promise<ProxyStatus> {
    return this.proxy.command('texas/view', { mode: 'hall' });
  }
  releaseTexas(): Promise<ProxyStatus> {
    return this.proxy.command('texas/release', {});
  }
}

export async function withTexasProxy<T>(task: (proxy: TexasProxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    return task(new TexasProxy(proxy));
  }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
}

export function texasProxyOptions(proxy: TexasProxy): BrowserContextOptions {
  return {
    proxy: { server: proxy.server, bypass: '<-loopback>' },
    ignoreHTTPSErrors: true,
  };
}

export const test = base.extend<{ mitmproxy: TexasProxy }>({
  mitmproxy: async ({}, use) => {
    await withTexasProxy(use);
  },
});

export const expect = playwrightExpect.configure({ timeout: 30_000 });
