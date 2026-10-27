/** 游戏测试代理及脱敏诊断历史访问入口。 */
import { test as base, expect as playwrightExpect, request, type BrowserContextOptions } from '@playwright/test';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type Mitmproxy, type ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

const TEXAS_NODE_STATUS_URL = 'https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/node/v1/status';
const NODE_PROBE_ATTEMPTS = 3;

/** 封装德州专用代理的牌局回放、大厅及面板响应控制。 */
export class TexasProxy {
  /**
   * 绑定本轮代理连接及认证配置。
   * @param proxy - 本轮独占的代理控制对象。
   */
  constructor(private readonly proxy: Mitmproxy) {}
  /** 读取当前专用代理的本机访问地址。 */
  get server(): string { return this.proxy.server; }
  /** 读取本任务代理的脱敏网络历史。 */
  diagnostics(): Promise<{ events: unknown[]; dropped: number }> {
    return this.proxy.command('diagnostics', undefined, 2000);
  }
  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<ProxyStatus & { replayedMessages: number }> {
    return this.proxy.command('status');
  }
  /**
   * 向当前德州房间推送固定回放消息。
   * @param roomId - 接收回放消息的房间 ID。
   * @param data - 子进程输出的数据块。
   */
  replayTexas(roomId: string, data: unknown): Promise<ProxyStatus> {
    return this.proxy.command('texas/replay', { roomId, data });
  }
  /** 切换到固定的德州大厅数据场景。 */
  configureHallView(): Promise<ProxyStatus> {
    return this.proxy.command('texas/view', { mode: 'hall' });
  }
  /** 切换到德州游客视角，验证登录前的游戏展示。 */
  configureGuestView(): Promise<ProxyStatus> {
    return this.proxy.command('texas/view', { mode: 'guest' });
  }
  /**
   * 设置德州申请列表或 RPC 错误响应，用于面板分支截图。
   * @param options - applications 指定申请列表状态，rpcError 指定要模拟的 RPC 错误。
   */
  configureUI(options: { applications?: 'pending' | 'resolved' | 'more'; rpcError?: 'retry' | 'balance' | 'auth' | null }): Promise<ProxyStatus> {
    return this.proxy.command('texas/ui', options);
  }
  /**
   * 设置新版德州战绩的正常记录或空列表。
   * @param empty - 是否返回空战绩列表。
   */
  configureNewRecords(empty: boolean): Promise<ProxyStatus> {
    return this.proxy.command('texas/records', { empty });
  }
  /** 释放代理暂缓的德州响应。 */
  releaseTexas(): Promise<ProxyStatus> {
    return this.proxy.command('texas/release', {});
  }
}

/**
 * 启动独立德州代理执行任务，并在结束或失败后清理代理。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 */
export async function withTexasProxy<T>(task: (proxy: TexasProxy) => Promise<T>): Promise<T> {
  return withMitmproxy(async proxy => {
    await proxy.stabilizeVisualNetwork();
    // 首次 HTTPS 连接会生成临时证书；节点偶发返回异常时重试，避免登录采集提前中止。
    const client = await request.newContext(texasProxyOptions(new TexasProxy(proxy)));
    try {
      let failure = '';
      let ready = false;
      for (let attempt = 1; attempt <= NODE_PROBE_ATTEMPTS; attempt += 1) {
        try {
          const response = await client.get(TEXAS_NODE_STATUS_URL, { timeout: 30_000 });
          const body: unknown = await response.json().catch(() => null);
          const load = body && typeof body === 'object' && 'server_load' in body
            ? body.server_load : undefined;
          if (response.ok() && load === 'normal') {
            ready = true;
            break;
          }
          failure = `HTTP ${response.status()}，server_load=${typeof load === 'string' ? load : '缺失'}`;
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        console.warn(`德州固定代理节点第 ${attempt}/${NODE_PROBE_ATTEMPTS} 次探测失败：${failure}`);
        if (attempt < NODE_PROBE_ATTEMPTS) await delay(attempt * 2_000);
      }
      if (!ready) throw new Error(`德州固定代理节点未就绪：${failure}`);
    } finally { await client.dispose(); }
    return task(new TexasProxy(proxy));
  }, { addonPath: path.resolve(__dirname, 'mitmproxy/addon.py') });
}

/**
 * 生成浏览器上下文使用本机代理所需的连接及证书选项。
 * @param proxy - 本轮独占的代理控制对象。
 */
export function texasProxyOptions(proxy: { server: string }): BrowserContextOptions {
  return {
    proxy: { server: proxy.server, bypass: '<-loopback>' },
    ignoreHTTPSErrors: true,
  };
}

export const test = base.extend<{ mitmproxy: TexasProxy }>({
  /**
   * 为案例提供独立游戏或弱网代理，结束后释放进程及证书目录。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  mitmproxy: async ({}, use) => {
    await withTexasProxy(use);
  },
});

export const expect = playwrightExpect.configure({ timeout: 30_000 });
