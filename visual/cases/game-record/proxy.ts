import { expect as baseExpect, test as base } from '@playwright/test';
import path from 'node:path';
import type { Mitmproxy, ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export type RecordMode = 'empty' | 'list' | 'no-hands' | 'paged' | 'list-error' | 'detail-error' | 'delete-error';
export type RecordStatus = ProxyStatus & {
  recordRequests: Record<string, number>; faultRequests: Record<string, number>; deleted: string[];
};

export class RecordProxy {
  constructor(private readonly proxy: Mitmproxy) {}
  get server(): string { return this.proxy.server; }
  private command(endpoint: string, payload?: unknown): Promise<RecordStatus> {
    return this.proxy.command(endpoint, payload, 30_000);
  }
  configure(userId: string, version: 'legacy' | 'v2', mode: RecordMode, hold = false): Promise<RecordStatus> {
    return this.command('records/configure', { userId, version, mode, hold });
  }
  mode(mode: RecordMode, hold = false): Promise<RecordStatus> {
    return this.command('records/mode', { mode, hold });
  }
  release(): Promise<RecordStatus> { return this.command('records/release', {}); }
  status(): Promise<RecordStatus> { return this.command('status'); }
}

export const test = base.extend<{ recordProxy: RecordProxy }>({
  recordProxy: async ({}, use) => {
    await withMitmproxy(async proxy => {
      await proxy.stabilizeVisualNetwork();
      await use(new RecordProxy(proxy));
    }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
  },
});
export const expect = baseExpect.configure({ timeout: 90_000 });
