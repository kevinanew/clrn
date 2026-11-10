import type { APIRequestContext } from '@playwright/test';
/**
 * 检查已部署的 Staging H5 是否只公开生产构建文件。
 * 验证脚本已压缩、源码映射无法下载，且原始项目文件不会由站点提供。
 */

import { expect, test } from './helpers/diagnostic-test';
import { environment } from './helpers/environment';
import { readPublicResourceContents } from './helpers/public-source-maps';

const originalSourcePaths = [
  '/App.js',
  '/index.web.js',
  '/babel.config.js',
  '/package.json',
  '/src/laiwan_fundamental_lib/run-game/model/GameContent.js',
];

test('staging 公开产物不暴露源码映射或原始源码', /** 验证staging 公开产物不暴露源码映射或原始源码。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, request }) => {
  const navigation = await page.goto(environment.stagingUrl, { waitUntil: 'domcontentloaded' });
  expect(navigation?.ok()).toBeTruthy();

  const origin = new URL(environment.stagingUrl).origin;
  const scriptAddresses = await page.locator('script[src]').evaluateAll(/** 读取页面加载的所有外部脚本地址，检查公开构建产物。
 * @param elements - 当前匹配的页面元素集合。 */ (elements) =>
    elements.map(/** 读取页面脚本地址，检查公开构建资源。
 * @param element - 当前匹配的页面元素。 */ (element) => (element as HTMLScriptElement).src),
  );
  const styleAddresses = await page.locator('link[rel="stylesheet"][href]').evaluateAll(/** 读取页面加载的样式表地址，检查公开样式产物。
 * @param elements - 当前匹配的页面元素集合。 */ (elements) =>
    elements.map(/** 读取页面链接资源地址，检查公开构建引用。
 * @param element - 当前匹配的页面元素。 */ (element) => (element as HTMLLinkElement).href),
  );
  const bundleAddresses = scriptAddresses.filter(/** 只检查同源 JavaScript 包，避免抓取第三方脚本。
 * @param address - 当前操作使用的 address。 */ (address) =>
    new URL(address).origin === origin && new URL(address).pathname.endsWith('.js'),
  );

  expect(bundleAddresses.length, '页面必须加载本站 JavaScript 产物').toBeGreaterThan(0);

  const workerAddress = new URL('/serviceWorker.js', environment.stagingUrl).href;
  const publicAddresses = [...bundleAddresses, workerAddress, ...styleAddresses];
  const contentsByAddress = await readPublicResourceContents(publicAddresses, origin, request);

  bundleAddresses.forEach(/** 检查每个部署的生产脚本。
   * @param address - 脚本地址。 */ address => assertProductionBundle(address, contentsByAddress));
  assertWorkerResource(contentsByAddress, workerAddress);
  await assertSourceMapsAbsent(publicAddresses, origin, request);

  for (const path of originalSourcePaths) {
    const address = new URL(path, environment.stagingUrl).href;
    const response = await request.get(address, { failOnStatusCode: false });
    expect(response.status(), `公开了原始项目文件：${address}`).toBe(404);
  }
});

/**
 * 保留生产标记和平均行长阈值。
 * @param address - 部署脚本地址。
 * @param contentsByAddress - 真实资源正文。
 */
function assertProductionBundle(address: string, contentsByAddress: Map<string, string>): void {
  const contents = contentsByAddress.get(address) ?? '';
  if (new URL(address).pathname.includes('/_expo/static/js/web/')) {
    expect(contents, `${address} 不是生产模式 bundle`).toContain('__DEV__=false');
    expect(averageLineLength(contents), `${address} 疑似未经压缩`).toBeGreaterThan(200);
  }
}

/**
 * 按原有换行计数计算压缩阈值。
 * @param contents - 脚本正文。
 */
function averageLineLength(contents: string): number {
  return contents.length / ((contents.match(/\n/g)?.length ?? 0) + 1);
}

/**
 * 固定构建要求 Service Worker 压缩且不保留块注释。
 * @param contents - 真实 Service Worker 正文。
 */
function assertWorker(contents: string): void {
  if (!environment.expectedBuildSha) return;
  expect(contents.trim().split('\n').length, 'Service Worker 未压缩').toBe(1);
  expect(contents, 'Service Worker 保留了源码注释').not.toContain('/*');
}

/**
 * 对同源真实资源逐一检查源码映射不可下载。
 * @param addresses - 实际资源地址。
 * @param origin - 站点来源。
 * @param request - 真实请求上下文。
 */
async function assertSourceMapsAbsent(addresses: string[], origin: string, request: APIRequestContext): Promise<void> {
  for (const address of addresses) {
    if (new URL(address).origin !== origin) continue;
    const sourceMapAddress = new URL(address);
    sourceMapAddress.pathname += '.map';
    const response = await request.get(sourceMapAddress.href, { failOnStatusCode: false });
    expect(response.status(), `公开了源码映射：${sourceMapAddress.href}`).toBe(404);
  }
}

/**
 * 沿用资源缺失时的空正文断言。
 * @param contents - 实际资源集合。
 * @param address - Service Worker 地址。
 */
function assertWorkerResource(contents: Map<string, string>, address: string): void {
  assertWorker(contents.get(address) ?? '');
}
