/**
 * 验证公开资源检查会拒绝 CSS 和 Service Worker 中内嵌的完整源码映射。
 * 仅替换 HTTP 响应边界，实际运行与线上冒烟共用的资源读取逻辑。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIRequestContext } from '@playwright/test';
import { readPublicResourceContents } from './public-source-maps';

const origin = 'https://h5.page.shafayouxi.org';
const scriptAddress = `${origin}/_expo/static/js/web/main.js`;
const styleAddress = `${origin}/style.css`;
const workerAddress = `${origin}/serviceWorker.js`;
const embeddedSourceMap = Buffer.from(JSON.stringify({
  version: 3,
  sources: ['private-source.js'],
  sourcesContent: ['const privateImplementation = 42;'],
  mappings: '',
})).toString('base64');

/**
 * 用预设正文替换 HTTP 边界，保持受测检查逻辑不变。
 * @param resources - 各公开地址返回的正文。
 */
function requestWithResources(resources: Map<string, string>): APIRequestContext {
  return {
    get: /**
     * 返回指定资源的 HTTP 响应。
     * @param address - 要读取的公开资源地址。
     */ async (address: string) => ({
      ok: /** 检查资源是否存在。 */ () => resources.has(address),
      text: /** 读取资源正文。 */ async () => resources.get(address) ?? '',
    }),
  } as unknown as APIRequestContext;
}

test('CSS 和 Service Worker 的内嵌源码映射均使公开资源检查失败', async () => {
  const originalResources = new Map([
    [scriptAddress, '__DEV__=false;'],
    [styleAddress, 'body{color:red}'],
    [workerAddress, "self.addEventListener('fetch',()=>{});"],
  ]);
  const exposedMaps = [
    [styleAddress, `/*# sourceMappingURL=data:application/json;base64,${embeddedSourceMap} */`],
    [workerAddress, `//# sourceMappingURL=data:application/json;base64,${embeddedSourceMap}`],
  ];
  for (const [address, reference] of exposedMaps) {
    const resources = new Map(originalResources);
    resources.set(address, `${resources.get(address)}${reference}`);
    await assert.rejects(
      readPublicResourceContents(
        [scriptAddress, workerAddress, styleAddress], origin, requestWithResources(resources),
      ),
      new RegExp(`公开资源包含源码映射引用：${address}`),
    );
  }
});
