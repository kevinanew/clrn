import { expect, test } from '@playwright/test';
import { environment } from './helpers/environment';

const originalSourcePaths = [
  '/App.js',
  '/index.web.js',
  '/babel.config.js',
  '/package.json',
  '/src/laiwan_fundamental_lib/run-game/model/GameContent.js',
];

test('staging 公开产物不暴露源码映射或原始源码', async ({ page, request }) => {
  const navigation = await page.goto(environment.stagingUrl, { waitUntil: 'domcontentloaded' });
  expect(navigation?.ok()).toBeTruthy();

  const origin = new URL(environment.stagingUrl).origin;
  const scriptAddresses = await page.locator('script[src]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLScriptElement).src),
  );
  const styleAddresses = await page.locator('link[rel="stylesheet"][href]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLLinkElement).href),
  );
  const bundleAddresses = scriptAddresses.filter((address) =>
    new URL(address).origin === origin && new URL(address).pathname.endsWith('.js'),
  );

  expect(bundleAddresses.length, '页面必须加载本站 JavaScript 产物').toBeGreaterThan(0);

  for (const address of bundleAddresses) {
    const response = await request.get(address);
    expect(response.ok(), `无法读取已部署的 JavaScript：${address}`).toBeTruthy();
    const contents = await response.text();
    expect(contents, `${address} 含有源码映射引用`).not.toMatch(
      /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/,
    );

    if (new URL(address).pathname.includes('/_expo/static/js/web/')) {
      expect(contents, `${address} 不是生产模式 bundle`).toContain('__DEV__=false');
      const averageLineLength = contents.length / ((contents.match(/\n/g)?.length ?? 0) + 1);
      expect(averageLineLength, `${address} 疑似未经压缩`).toBeGreaterThan(200);
    }
  }

  const workerAddress = new URL('/serviceWorker.js', environment.stagingUrl).href;
  const workerResponse = await request.get(workerAddress);
  expect(workerResponse.ok(), `无法读取 Service Worker：${workerAddress}`).toBeTruthy();
  const workerContents = await workerResponse.text();
  if (environment.expectedBuildSha) {
    expect(workerContents.trim().split('\n').length, 'Service Worker 未压缩').toBe(1);
    expect(workerContents, 'Service Worker 保留了源码注释').not.toContain('/*');
  }

  for (const address of [...bundleAddresses, workerAddress, ...styleAddresses]) {
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
