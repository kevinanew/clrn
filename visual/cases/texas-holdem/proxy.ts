import { test as base, expect as playwrightExpect, request, type BrowserContextOptions } from '@playwright/test';
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
  configureGuestView(): Promise<ProxyStatus> {
    return this.proxy.command('texas/view', { mode: 'guest' });
  }
  configureUI(options: { applications?: 'pending' | 'resolved' | 'more'; rpcError?: 'retry' | 'balance' | 'auth' | null }): Promise<ProxyStatus> {
    return this.proxy.command('texas/ui', options);
  }
  configureNewRecords(empty: boolean): Promise<ProxyStatus> {
    return this.proxy.command('texas/records', { empty });
  }
  releaseTexas(): Promise<ProxyStatus> {
    return this.proxy.command('texas/release', {});
  }
}

export async function withTexasProxy<T>(task: (proxy: TexasProxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    // 首次 HTTPS 连接会生成临时证书，先预热固定节点，避免浏览器的 5 秒测速超时。
    const client = await request.newContext(texasProxyOptions(new TexasProxy(proxy)));
    try {
      const response = await client.get('https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/node/v1/status',
        { timeout: 90_000 });
      if (!response.ok() || (await response.json()).server_load !== 'normal') {
        throw new Error('德州固定代理节点未就绪');
      }
    } finally { await client.dispose(); }
    return task(new TexasProxy(proxy));
  }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
}

export function texasProxyOptions(proxy: { server: string }): BrowserContextOptions {
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
