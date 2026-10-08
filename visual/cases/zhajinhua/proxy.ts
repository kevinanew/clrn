import { test as base, expect as playwrightExpect, type BrowserContextOptions } from '@playwright/test';
import path from 'node:path';
import type { Mitmproxy, ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export class ZhajinhuaProxy {
  constructor(private readonly proxy: Mitmproxy) {}
  get server(): string { return this.proxy.server; }
  status(): Promise<ProxyStatus & { replayedMessages: number; blockedRpcs: number }> { return this.proxy.command('status'); }
  replay(roomId: string, data: unknown): Promise<ProxyStatus> {
    return this.proxy.command('zhajinhua/replay', { roomId, data });
  }
  release(): Promise<ProxyStatus> { return this.proxy.command('zhajinhua/release', {}); }
}

export function withZhajinhuaProxy<T>(task: (proxy: ZhajinhuaProxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    return task(new ZhajinhuaProxy(proxy));
  }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
}

export function zhajinhuaProxyOptions(proxy: ZhajinhuaProxy): BrowserContextOptions {
  return { proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true };
}

export const test = base.extend<{ mitmproxy: ZhajinhuaProxy }>({
  mitmproxy: async ({}, use) => { await withZhajinhuaProxy(use); },
});
export const expect = playwrightExpect.configure({ timeout: 30_000 });
