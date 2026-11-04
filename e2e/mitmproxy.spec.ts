import { createServer } from 'node:http';
import { test, expect } from './helpers/mitmproxy';

// 离线集成检查使用真实 mitmdump 和浏览器代理，无需访问 staging。
test('mitmproxy 透传本地请求，故障切换与清除可读回', /** 验证mitmproxy 透传本地请求，故障切换与清除可读回。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, mitmproxy }) => {
  const upstream = createServer(/** 为代理连通性测试返回可辨识的上游页面。
 * @param _request - 当前操作使用的 _request。
 * @param response - 当前收到的接口响应。 */ (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<h1>upstream reached</h1>');
  });
  await new Promise<void>(/** 等待代理测试的本机上游服务开始监听。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => upstream.listen(0, '127.0.0.1', resolve));
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
    await new Promise<void>(/** 关闭上游服务及残留连接，等待清理完成。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
      upstream.close(/** 将上游服务关闭结果传递给清理等待。
 * @param error - 当前操作抛出的错误。 */ error => error ? reject(error) : resolve());
      upstream.closeAllConnections();
    });
  }
});

test('mitmproxy 在真实 HTTPS 请求中断开登录接口并记录命中', /** 验证mitmproxy 在真实 HTTPS 请求中断开登录接口并记录命中。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ playwright, mitmproxy }) => {
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
