/**
 * 读取站点同域公开资源，并拒绝正文中携带源码映射引用的脚本与样式。
 * 供线上冒烟测试同时检查 JavaScript、CSS 和 Service Worker。
 */

import type { APIRequestContext } from '@playwright/test';

const sourceMapReference = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/;

/**
 * 读取同域资源正文，遇到下载失败或源码映射引用时立即失败。
 * @param addresses - 页面引用的脚本、样式及 Service Worker 地址。
 * @param origin - 当前站点的同源地址。
 * @param request - Playwright 的真实 HTTP 请求上下文。
 */
export async function readPublicResourceContents(
  addresses: string[], origin: string, request: APIRequestContext,
): Promise<Map<string, string>> {
  const contentsByAddress = new Map<string, string>();
  for (const address of addresses) {
    if (new URL(address).origin !== origin) continue;
    const response = await request.get(address);
    if (!response.ok()) throw new Error(`无法读取已部署的公开资源：${address}`);
    const contents = await response.text();
    if (sourceMapReference.test(contents)) throw new Error(`公开资源包含源码映射引用：${address}`);
    contentsByAddress.set(address, contents);
  }
  return contentsByAddress;
}
