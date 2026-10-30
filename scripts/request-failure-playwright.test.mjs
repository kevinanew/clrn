/** 锁定版本的真实 APIRequestContext 只连接本例回环服务，不使用账号或业务接口。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import test from 'node:test';
import { request } from '@playwright/test';
import { requestFailureReason, safeDiagnosticReason } from './request-failure.cjs';
import requestError from '../visual/src/support/requestError.ts';
import requestJson from '../visual/src/support/requestJson.ts';

const { requestErrorSummary } = requestError;
const { readRequestJson } = requestJson;
const secret = 'synthetic-playwright-secret';

/**
 * 核对上层异常不带真实请求的地址、调用日志或合成认证信息。
 * @param error - 边界已转换的实际异常。
 * @param status - 仅来自实际 APIResponse 的状态，无响应时明确不可得。
 * @param reason - 固定错误类别。
 */
function checkFailure(error, status, reason) {
  assert.ok(error instanceof Error);
  assert.match(error.message, new RegExp(`method=GET operation=release-readiness source=release-static status=${status} response=${status === 'unavailable' ? 'not-received' : 'received'} reason=${reason}$`));
  assert.equal(error.cause, undefined);
  const upper = new Error(secret, { cause: error });
  const outputs = [inspect(error, { depth: 20 }), safeDiagnosticReason(upper), safeDiagnosticReason(error.message)];
  for (const output of outputs) {
    assert.ok(!output.includes(secret));
    assert.doesNotMatch(output, /127\.0\.0\.1|https?:\/\/|Authorization|Cookie|Call log/);
    assert.ok(output.includes(error.message));
  }
}

test('真实 Playwright HTTP500、无效 JSON、超时、断连和拒绝连接仍失败且安全定位', async context => {
  const seen = new Set();
  const server = createServer((incoming, outgoing) => {
    const route = new URL(incoming.url, 'http://fixture.invalid').pathname;
    seen.add(route);
    if (route === '/timeout') return;
    if (route === '/disconnect') { incoming.socket.destroy(); return; }
    outgoing.writeHead(route === '/http-error' ? 500 : 201, { 'Content-Type': 'application/json' });
    outgoing.end(secret);
  });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const api = await request.newContext({ extraHTTPHeaders: {
    Authorization: `Bearer ${secret}`, Cookie: `session=${secret}`,
  } });
  context.after(() => api.dispose());
  const origin = `http://127.0.0.1:${server.address().port}`;

  /**
   * 在真实请求与 JSON 边界运行生产转换函数，无响应时不创建虚构 APIResponse。
   * @param route - 本例服务器或其关闭后的路径。
   */
  async function read(route) {
    const response = await api.get(`${origin}${route}?token=${secret}`, {
      timeout: 1000, maxRetries: 0, maxRedirects: 0,
    }).catch(error => {
      if (route === '/timeout' || route === '/refused' || route === '/disconnect') {
        assert.equal(error.code, undefined, '覆盖 Playwright 丢弃顶层 code 的真实形态');
        assert.equal(error.name, route === '/timeout' ? 'TimeoutError' : 'Error');
        if (route === '/refused') assert.ok(error.message.includes('ECONNREFUSED'));
        if (route === '/disconnect') assert.equal(error.message.split(/\r?\n/)[0], 'apiRequestContext.get: socket hang up');
        assert.equal(requestFailureReason(error), route === '/timeout' ? 'timeout' : 'connection-failed');
      }
      throw new Error(requestErrorSummary(error, 'release-readiness'));
    });
    try { return await readRequestJson(response, 'release-readiness'); }
    finally { await response.dispose(); }
  }

  for (const [route, status, reason] of [['/http-error', '500', 'http-error'],
    ['/invalid-json', '201', 'invalid-json'], ['/timeout', 'unavailable', 'timeout'],
    ['/disconnect', 'unavailable', 'connection-failed']]) {
    await context.test(reason, async () => {
      await assert.rejects(read(route), error => { checkFailure(error, status, reason); return true; });
      assert.ok(seen.has(route), '确认请求实际到达本例服务');
    });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await context.test('connection-failed', async () => {
    await assert.rejects(read('/refused'), error => { checkFailure(error, 'unavailable', 'connection-failed'); return true; });
    assert.equal(seen.has('/refused'), false);
  });
});
