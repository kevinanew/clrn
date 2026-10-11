import { test as base, expect as playwrightExpect, type BrowserContextOptions } from '@playwright/test';
import path from 'node:path';
import type { Mitmproxy, ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

/** 封装拼三张专用代理的固定牌局回放与响应释放。 */
export class ZhajinhuaProxy {
  /**
   * 绑定本轮代理连接及认证配置。
   * @param proxy - 本轮独占的代理控制对象。
   */
  constructor(private readonly proxy: Mitmproxy) {}
  /** 读取当前专用代理的本机访问地址。 */
  get server(): string { return this.proxy.server; }
  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<ProxyStatus & { replayedMessages: number; blockedRpcs: number }> { return this.proxy.command('status'); }
  /**
   * 向当前拼三张房间推送固定回放消息。
   * @param roomId - 接收回放消息的房间 ID。
   * @param data - 子进程输出的数据块。
   */
  replay(roomId: string, data: unknown): Promise<ProxyStatus> {
    return this.proxy.command('zhajinhua/replay', { roomId, data });
  }
  /** 释放代理暂缓的响应，让测试继续进入完成状态。 */
  release(): Promise<ProxyStatus> { return this.proxy.command('zhajinhua/release', {}); }
}

/**
 * 启动独立拼三张代理执行任务，并在结束或失败后清理代理。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 */
export function withZhajinhuaProxy<T>(task: (proxy: ZhajinhuaProxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    return task(new ZhajinhuaProxy(proxy));
  }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
}

/**
 * 生成拼三张浏览器上下文使用本机代理的连接选项。
 * @param proxy - 本轮独占的代理控制对象。
 */
export function zhajinhuaProxyOptions(proxy: ZhajinhuaProxy): BrowserContextOptions {
  return { proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true };
}

export const test = base.extend<{ mitmproxy: ZhajinhuaProxy }>({
  /**
   * 为案例提供独立游戏或弱网代理，结束后释放进程及证书目录。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  mitmproxy: async ({}, use) => { await withZhajinhuaProxy(use); },
});
export const expect = playwrightExpect.configure({ timeout: 30_000 });
