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

test('真实 Playwright HTTP500、无效 JSON、超时、断连和拒绝连接仍失败且安全定位', /** 验证真实 Playwright HTTP500、无效 JSON、超时、断连和拒绝连接仍失败且安全定位。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const seen = new Set();
  const server = createServer(/** 按请求路径制造超时、断连和指定状态的真实 HTTP 失败。
 * @param incoming - 本机测试服务收到的请求。
 * @param outgoing - 本机测试服务发送的响应。 */ (incoming, outgoing) => {
    const route = new URL(incoming.url, 'http://fixture.invalid').pathname;
    seen.add(route);
    if (route === '/timeout') return;
    if (route === '/disconnect') { incoming.socket.destroy(); return; }
    outgoing.writeHead(fixtureStatus(route), { 'Content-Type': 'application/json' });
    outgoing.end(secret);
  });
  context.after(/** 关闭请求失败测试服务及所有遗留连接。 */ async () => {
    server.closeAllConnections();
    await new Promise(/** 等待请求失败测试服务完成关闭。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => server.close(resolve));
  });
  await new Promise(/** 等待本机错误场景服务开始监听，传播监听失败。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const api = await request.newContext({ extraHTTPHeaders: {
    Authorization: `Bearer ${secret}`, Cookie: `session=${secret}`,
  } });
  context.after(/** 用例结束后释放 Playwright API 请求上下文。 */ () => api.dispose());
  const origin = `http://127.0.0.1:${server.address().port}`;

  /**
   * 在真实请求与 JSON 边界运行生产转换函数，无响应时不创建虚构 APIResponse。
   * @param route - 本例服务器或其关闭后的路径。
   */
  async function read(route) {
    const response = await api.get(`${origin}${route}?token=${secret}`, {
      timeout: 1000, maxRetries: 0, maxRedirects: 0,
    }).catch(/** 检查真实 Playwright 异常形态，并将其交给安全诊断分类。
 * @param error - 当前操作抛出的错误。 */ error => {
      checkRawFailure(route, error);
      throw new Error(requestErrorSummary(error, 'release-readiness'));
    });
    try { return await readRequestJson(response, 'release-readiness'); }
    finally { await response.dispose(); }
  }

  for (const [route, status, reason] of [['/http-error', '500', 'http-error'],
    ['/invalid-json', '201', 'invalid-json'], ['/timeout', 'unavailable', 'timeout'],
    ['/disconnect', 'unavailable', 'connection-failed']]) {
    await context.test(reason, /** 验证当前 HTTP 路由的安全失败诊断且请求确实到达服务。 */ async () => {
      await assert.rejects(read(route), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => { checkFailure(error, status, reason); return true; });
      assert.ok(seen.has(route), '确认请求实际到达本例服务');
    });
  }
  server.closeAllConnections();
  await new Promise(/** 关闭监听端口，构造真实的连接拒绝场景。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => server.close(resolve));
  await context.test('connection-failed', /** 验证连接拒绝的真实 Playwright 请求被归类为安全的连接失败诊断。 */ async () => {
    await assert.rejects(read('/refused'), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => { checkFailure(error, 'unavailable', 'connection-failed'); return true; });
    assert.equal(seen.has('/refused'), false);
  });
});

/** 为本机 HTTP 负例选择原有响应状态。
 * @param route - 测试请求路径。 */
function fixtureStatus(route) { return route === '/http-error' ? 500 : 201; }

/** 验证 Playwright 丢弃 code 后的真实异常形态。
 * @param route - 本机请求路径。
 * @param error - 真实 Playwright 异常。 */
function checkRawFailure(route, error) {
  const expected = { '/timeout': ['TimeoutError', 'timeout'], '/refused': ['Error', 'connection-failed'],
    '/disconnect': ['Error', 'connection-failed'] }[route];
  if (!expected) return;
  assert.equal(error.code, undefined, '覆盖 Playwright 丢弃顶层 code 的真实形态');
  assert.equal(error.name, expected[0]);
  checkConnectionMessage(route, error);
  assert.equal(requestFailureReason(error), expected[1]);
}

/** 真实拒绝连接和断连首行仍须符合锁定版本的异常契约。
 * @param route - 本机请求路径。
 * @param error - 真实 Playwright 异常。 */
function checkConnectionMessage(route, error) {
  if (route === '/refused') assert.ok(error.message.includes('ECONNREFUSED'));
  if (route === '/disconnect') assert.equal(error.message.split(/\r?\n/)[0], 'apiRequestContext.get: socket hang up');
}
