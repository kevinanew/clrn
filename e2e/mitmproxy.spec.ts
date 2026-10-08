import { createServer } from 'node:http';
import { test, expect } from './helpers/mitmproxy';

// 离线集成检查使用真实 mitmdump 和浏览器代理，无需访问 staging。
test('mitmproxy 透传本地请求，故障切换与清除可读回', async ({ page, mitmproxy }) => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<h1>upstream reached</h1>');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    // 只有代理插件能响应这个保留域名，控制 token 不进入浏览器。
    const forbidden = await page.goto('http://test-mitmproxy.invalid/status');
    expect(forbidden?.status()).toBe(403);
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('无法分配上游端口');
    await mitmproxy.inject('club-failure');
    expect((await mitmproxy.status()).scenario).toBe('club-failure');
    // fixture 禁用 Chromium 对本机地址的默认代理绕过。
    await page.goto(`http://127.0.0.1:${address.port}/v10/club?user_id=offline`);
    await expect(page.getByRole('heading')).toHaveText('upstream reached');
    expect((await mitmproxy.status()).interceptedRequests).toBe(0);
    expect((await mitmproxy.clear()).scenario).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => {
      upstream.close(error => error ? reject(error) : resolve());
      upstream.closeAllConnections();
    });
  }
});

test('mitmproxy 在真实 HTTPS 请求中断开登录接口并记录命中', async ({ playwright, mitmproxy }) => {
  await mitmproxy.inject('login-failure');
  const client = await playwright.request.newContext({
    proxy: { server: mitmproxy.server }, ignoreHTTPSErrors: true,
  });
  try {
    // 延迟建立上游连接，让插件在访问 staging 前断开此请求。
    await expect(client.post('https://api.shafayouxi.org/public/v10/user/login/username/password', {
      data: { username: 'offline-check' }, timeout: 5_000,
    })).rejects.toThrow();
    expect((await mitmproxy.status()).interceptedRequests).toBeGreaterThan(0);
  } finally {
    await client.dispose();
  }
});

test('mitmproxy 稳定视觉节点列表和健康检查，放行 CORS 预检', async ({ playwright, mitmproxy }) => {
  await mitmproxy.stabilizeVisualNetwork();
  const client = await playwright.request.newContext({
    proxy: { server: mitmproxy.server }, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: 'https://h5.page.shafayouxi.org' },
  });
  const host = '64.kr-seoul.api.staging.laiwan.shafayouxi.com';
  try {
    const metadata = await client.get('https://api.shafayouxi.org/public/v13/metadata/servers');
    expect((await metadata.json()).result.servers).toEqual({ [host]: '127.0.0.1' });
    expect(metadata.headers()['access-control-allow-origin']).toBe('https://h5.page.shafayouxi.org');
    const selected = await client.get(`https://${host}/node/v1/status`);
    expect(await selected.json()).toEqual({ backend_delay: 0, server_load: 'normal' });
    const unavailable = await client.get('https://offline.api.staging.laiwan.shafayouxi.com/node/v1/status');
    expect(unavailable.status()).toBe(503);
    const preflight = await client.fetch(`https://${host}/node/v1/status`, {
      method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(preflight.status()).toBe(204);
    expect(preflight.headers()['access-control-allow-headers']).toBe('authorization');
    expect((await mitmproxy.status()).stabilizedRequests).toBe(4);
  } finally {
    await client.dispose();
  }
});
