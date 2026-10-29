/** 使用合成凭据与隔离响应验证账号准备的故障定位、真实状态及脱敏传播。 */
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import test from 'node:test';
import { prepareTestAccountCoins } from './prepare-test-account.mjs';
import { requestFailure, safeDiagnosticReason } from './request-failure.cjs';

const sensitive = 'https://user:synthetic-password@request.invalid:9443/private?token=synthetic-token 192.0.2.10 [2001:db8::10] Bearer synthetic-bearer Cookie: sid=synthetic-cookie';
const session = { user_id: '11111111-2222-4333-8444-555555555555', username: 'fixture01',
  api_token: { token_type: 'Bearer', access_token: 'synthetic-session' } };
const prepared = { wallet_id: session.user_id, currency_name: 'coin', balance: '10000' };

/**
 * 验证错误对象包括堆栈和 cause 均不含模拟连接信息或合成凭据。
 * @param error - 待传播的实际错误。
 */
function checkPrivate(error) {
  const serialized = inspect(error, { depth: 20 });
  for (const value of ['request.invalid', '192.0.2.10', '2001:db8::10', '9443', '/private', 'synthetic-']) {
    assert.ok(!serialized.includes(value), `不允许输出 ${value}`);
  }
  assert.equal(error.cause, undefined);
}

test('三阶段 HTTP500、超时、连接失败、解析失败及业务拒绝保留方法、操作和实际状态', async context => {
  const cases = [
    [() => new Response(sensitive, { status: 500 }), '500', 'http-error'],
    [() => Object.assign(new Error(sensitive, { cause: new Error(sensitive) }), { name: 'TimeoutError' }), 'unavailable', 'timeout'],
    [() => Object.assign(new Error(sensitive, { cause: new Error(sensitive) }), { code: 'ECONNRESET' }), 'unavailable', 'connection-failed'],
    [() => new Response(sensitive, { status: 201 }), '201', 'invalid-json'],
    [() => new Response(new ReadableStream({ /** 注入正文读取异常。
 * @param controller - 隔离响应流控制器。
 */ start(controller) { controller.error(new Error(sensitive)); } }), { status: 202 }), '202', 'body-read-failed'],
    [() => Response.json({ ok: false, reason: sensitive, errors: { [sensitive]: sensitive } }), '200', 'business-rejected'],
  ];
  for (const [stage, operation, method] of [[0, 'prepare-account-login', 'POST'],
    [1, 'prepare-account-set-coins', 'POST'], [2, 'prepare-account-verify-coins', 'PUT']]) {
    for (const [reply, status, reason] of cases) {
      let calls = 0;
      context.mock.method(globalThis, 'fetch', async () => {
        if (calls++ < stage) return Response.json({ ok: true, result: calls === 1 ? session : prepared });
        const response = reply();
        if (response instanceof Error) throw response;
        return response;
      });
      await assert.rejects(prepareTestAccountCoins({ username: session.username, password: 'synthetic-password' }, 'synthetic-admin'), error => {
        checkPrivate(error);
        assert.match(error.message, new RegExp(`method=${method} operation=${operation} source=laiwan_prd status=${status} .*reason=${reason}$`));
        assert.match(error.message, status === 'unavailable' ? /response=not-received/ : /response=received/);
        assert.equal(safeDiagnosticReason(new Error(sensitive, { cause: error })), error.message);
        return true;
      });
      assert.equal(calls, stage + 1, '失败必须中止准备，不能继续写入或读取');
      context.mock.restoreAll();
    }
  }
});

test('操作、原因及诊断消息均采用允许列表；不猜测未知异常中的 HTTP 状态', () => {
  checkPrivate(requestFailure(sensitive, sensitive, 500));
  assert.match(requestFailure(sensitive, sensitive).message, /operation=unknown-request/);
  assert.equal(safeDiagnosticReason('接口请求失败：method=UNKNOWN operation=unknown-request source=laiwan_prd status=499 response=received reason=http-error'),
    'detail=withheld reason=request-failed', '任意后端文字不能伪造一个本进程未收到的状态');
  const raw = new Error(`HTTP 503 ${sensitive}`, { cause: { status: 500, message: sensitive } });
  assert.equal(safeDiagnosticReason(raw), 'detail=withheld reason=request-failed');
  const cycle = new Error(sensitive);
  cycle.cause = cycle;
  assert.equal(safeDiagnosticReason(cycle), 'detail=withheld reason=request-failed');
  assert.equal(safeDiagnosticReason({ /** 模拟不可访问的底层异常。 */ get cause() { throw raw; } }), 'detail=withheld reason=request-failed');
  assert.equal(safeDiagnosticReason(requestFailure('room-create', 'http-error', 503).message),
    requestFailure('room-create', 'http-error', 503).message);
});
