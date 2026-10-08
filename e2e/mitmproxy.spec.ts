import { createServer } from 'node:http';
import { test, expect } from './helpers/mitmproxy';

// Offline integration checks use the real mitmdump executable and browser proxy.
test('mitmproxy 透传本地请求，故障切换与清除可读回', async ({ page, mitmproxy }) => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<h1>upstream reached</h1>');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    // Only the addon can answer this reserved hostname; no token enters the browser.
    const forbidden = await page.goto('http://e2e-mitmproxy.invalid/status');
    expect(forbidden?.status()).toBe(403);
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('无法分配上游端口');
    await mitmproxy.inject('club-failure');
    expect((await mitmproxy.status()).scenario).toBe('club-failure');
    // The fixture disables Chromium's default loopback proxy bypass.
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
    // Lazy connections let the addon kill this request without contacting staging.
    await expect(client.post('https://api.shafayouxi.org/public/v10/user/login/username/password', {
      data: { username: 'offline-check' }, timeout: 5_000,
    })).rejects.toThrow();
    expect((await mitmproxy.status()).interceptedRequests).toBeGreaterThan(0);
  } finally {
    await client.dispose();
  }
});
