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

  for (const address of bundleAddresses) {
    const contents = contentsByAddress.get(address) ?? '';

    if (new URL(address).pathname.includes('/_expo/static/js/web/')) {
      expect(contents, `${address} 不是生产模式 bundle`).toContain('__DEV__=false');
      const averageLineLength = contents.length / ((contents.match(/\n/g)?.length ?? 0) + 1);
      expect(averageLineLength, `${address} 疑似未经压缩`).toBeGreaterThan(200);
    }
  }

  const workerContents = contentsByAddress.get(workerAddress) ?? '';
  if (environment.expectedBuildSha) {
    expect(workerContents.trim().split('\n').length, 'Service Worker 未压缩').toBe(1);
    expect(workerContents, 'Service Worker 保留了源码注释').not.toContain('/*');
  }

  for (const address of publicAddresses) {
    if (new URL(address).origin !== origin) {
      continue;
    }
    const sourceMapAddress = new URL(address);
    sourceMapAddress.pathname += '.map';
    const response = await request.get(sourceMapAddress.href, { failOnStatusCode: false });
    expect(response.status(), `公开了源码映射：${sourceMapAddress.href}`).toBe(404);
  }

  for (const path of originalSourcePaths) {
    const address = new URL(path, environment.stagingUrl).href;
    const response = await request.get(address, { failOnStatusCode: false });
    expect(response.status(), `公开了原始项目文件：${address}`).toBe(404);
  }
});
