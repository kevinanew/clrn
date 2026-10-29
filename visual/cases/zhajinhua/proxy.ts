/** 游戏测试代理及脱敏诊断历史访问入口。 */
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
  /** 读取共用场景控制客户端。 */
  get network(): Mitmproxy { return this.proxy; }
  /** 读取当前专用代理的本机访问地址。 */
  get server(): string { return this.proxy.server; }
  /** 读取本任务代理的脱敏网络历史。 */
  diagnostics(): Promise<{ events: unknown[]; dropped: number }> {
    return this.proxy.command('diagnostics', undefined, 2000);
  }
  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<ProxyStatus & { replayedMessages: number; blockedRpcs: number }> { return this.proxy.command('status'); }
  /**
   * 向当前拼三张房间推送固定回放消息。
   * @param roomId - 接收回放消息的房间 ID。
   * @param scene - Python 中登记的具名回放场景。
   */
  replay(roomId: string, scene: { scene: string; parameters?: Record<string, string> }): Promise<ProxyStatus> {
    return this.proxy.command('zhajinhua/replay', { roomId, scene });
  }
  /**
   * 仅为当前已绑定房间的操作响应启用经验与升级夹具。
   * @param roomId - 本轮独占房间。
   * @param enabled - 是否返回固定奖励。
   */
  operationReward(roomId: string, enabled: boolean): Promise<ProxyStatus> {
    return this.proxy.command('zhajinhua/operation-reward', { roomId, enabled });
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
    await proxy.enableVisualFixtures();
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
