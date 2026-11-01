/** 使用合成凭据与隔离响应验证账号准备的故障定位、真实状态及脱敏传播。 */
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import test from 'node:test';
import { prepareTestAccountCoins } from './prepare-test-account.mjs';
import { requestFailure, requestFailureReason, safeDiagnosticReason } from './request-failure.cjs';

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

test('私有接口、本地Release及UI状态使用固定逻辑来源，未知或本地阶段不能伪造HTTP状态', () => {
  for (const operation of ['release-readiness', 'release-static-read']) {
    const error = requestFailure(operation, 'http-error', 503);
    assert.match(error.message, new RegExp(`method=GET operation=${operation} source=release-static status=503 response=received`));
    assert.equal(safeDiagnosticReason(new Error(sensitive, { cause: error })), error.message);
    assert.equal(safeDiagnosticReason(error.message), error.message);
    checkPrivate(error);
  }
  assert.match(requestFailure('prepare-account-login', 'http-error', 500).message,
    /method=POST operation=prepare-account-login source=laiwan_prd status=500 response=received/);
  for (const [operation, method, source] of [
    ['room-read-session', 'LOCAL', 'browser-state'],
    ['existing-account-setup', 'LOCAL', 'browser-ui'],
    ['existing-account-login-await', 'UNKNOWN', 'browser-ui'],
    ['unknown-request', 'UNKNOWN', 'unknown'],
  ]) {
    const error = requestFailure(operation, 'request-failed', 500);
    assert.match(error.message, new RegExp(`method=${method} operation=${operation} source=${source} status=unavailable response=not-received`));
    checkPrivate(error);
  }
  const injected = requestFailure(sensitive, sensitive, 500, sensitive);
  assert.match(injected.message, /method=UNKNOWN operation=unknown-request source=unknown status=unavailable/);
  checkPrivate(injected);
});

test('Playwright 无顶层 code 的已知连接错误只映射有限枚举，不回显消息或调用日志', () => {
  for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'fetch']) {
    for (const ending of ['', `\nCall log:\n - ${sensitive}`, `\r\nCall log:\r\n - ${sensitive}`]) {
      const error = new Error(`apiRequestContext.${method}: socket hang up${ending}`);
      assert.equal(error.code, undefined);
      assert.equal(requestFailureReason(error), 'connection-failed');
      const failure = requestFailure('room-read-diamonds', requestFailureReason(error));
      checkPrivate(failure);
      assert.match(failure.message, /status=unavailable response=not-received reason=connection-failed$/);
    }
    for (const [prefix, code] of [['connect', 'ECONNREFUSED'], ['read', 'ECONNRESET'],
      ['getaddrinfo', 'ENOTFOUND'], ['getaddrinfo', 'EAI_AGAIN'], ['', 'UND_ERR_SOCKET']]) {
      const error = new Error(`apiRequestContext.${method}: ${prefix ? `${prefix} ` : ''}${code} ${sensitive}\nCall log:\n - ${sensitive}`);
      assert.equal(error.name, 'Error');
      assert.equal(error.code, undefined);
      assert.equal(requestFailureReason(error), 'connection-failed');
      const failure = requestFailure('room-read-diamonds', requestFailureReason(error));
      assert.match(failure.message, /method=PUT operation=room-read-diamonds source=laiwan_prd status=unavailable response=not-received reason=connection-failed$/);
      checkPrivate(failure);
      assert.equal(safeDiagnosticReason(new Error(sensitive, { cause: failure })), failure.message);
      assert.equal(requestFailureReason(new Error(sensitive, { cause: error })), 'connection-failed');
    }
  }
  for (const message of [sensitive, `ECONNREFUSED ${sensitive}`, `apiRequestContext.put: UnknownError ${sensitive}`,
    `apiRequestContext.put: ${sensitive}\nCall log:\n - ECONNREFUSED`,
    `apiRequestContext.put: connect ECONNREFUSED_UNKNOWN ${sensitive}`,
    `apiRequestContext.put: connect ECONNREFUSED.invalid ${sensitive}`,
    `apiRequestContext.get: socket hang up ${sensitive}`,
    'apiRequestContext.get: socket hang up.invalid',
    `apiRequestContext.get: ${sensitive}/socket hang up`,
    'apiRequestContext.get: UnknownError\nCall log:\n - socket hang up',
    'apiRequestContext.get: UnknownError\napiRequestContext.get: socket hang up',
    `apiRequestContext.put: UnknownError\napiRequestContext.put: connect ECONNREFUSED ${sensitive}`]) {
    assert.equal(requestFailureReason(new Error(message)), 'request-failed', '任意消息、地址或调用日志中的字样不能充当连接错误枚举');
  }
});

test('Playwright 重试耗尽的固定断连包装仍保留连接失败，不能从任意内部文本推断', () => {
  for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'fetch']) {
    for (const ending of ['', `\nCall log:\n - ${sensitive}`, `\r\nCall log:\r\n - ${sensitive}`]) {
      const raw = new Error(`apiRequestContext.${method}: Failed after 3 attempt(s): Error: socket hang up${ending}`);
      assert.equal(requestFailureReason(raw), 'connection-failed');
      const failure = requestFailure('existing-account-session', requestFailureReason(raw));
      assert.match(failure.message, /method=GET operation=existing-account-session source=laiwan_prd status=unavailable response=not-received reason=connection-failed$/);
      assert.equal(safeDiagnosticReason(new Error(sensitive, { cause: failure })), failure.message);
      checkPrivate(failure);
    }
  }
  for (const detail of ['Failed after 0 attempt(s): Error: socket hang up',
    'Failed after 3 attempts: Error: socket hang up',
    `Failed after 3 attempt(s): Error: socket hang up ${sensitive}`,
    'Failed after 3 attempt(s): Error: socket hang up.invalid',
    `Failed after 3 attempt(s): Error: ${sensitive}/socket hang up`,
    'UnknownError\nFailed after 3 attempt(s): Error: socket hang up']) {
    assert.equal(requestFailureReason(new Error(`apiRequestContext.get: ${detail}`)), 'request-failed');
  }
});
