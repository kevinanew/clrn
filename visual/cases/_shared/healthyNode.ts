/** 在视觉测试开始前经由同一代理录制合格的真实节点健康响应。 */
import { request } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Mitmproxy } from '../../../e2e/helpers/mitmproxy-client';

const NODE_STATUS_URL = 'https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/node/v1/status';
const ATTEMPTS = 5;

/**
 * 只有真实响应满足应用牌桌选址条件时才开始截图；代理随后回放录制的完整响应。
 * @param proxy - 当前用例独占的代理。
 * @param game - 用于标识失败的游戏名称。
 */
export async function recordHealthyNode(proxy: Mitmproxy, game: string): Promise<void> {
  const client = await request.newContext({
    proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
  });
  try {
    let failure = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const response = await client.get(NODE_STATUS_URL, { timeout: 30_000 });
        const body: unknown = await response.json().catch(() => null);
        const status = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const backendDelay = status.backend_delay;
        if (response.ok() && status.server_load === 'normal'
            && typeof backendDelay === 'number' && backendDelay >= 0 && backendDelay < 1000) return;
        failure = `HTTP ${response.status()}，server_load=${String(status.server_load)}，backend_delay=${String(backendDelay)}`;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      console.warn(`${game} 固定节点第 ${attempt}/${ATTEMPTS} 次健康录制未就绪：${failure}`);
      if (attempt < ATTEMPTS) await delay(attempt * 1_000);
    }
    throw new Error(`${game} 固定节点无法录制合格的真实健康响应：${failure}`);
  } finally { await client.dispose(); }
}
