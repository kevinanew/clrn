/** 账号创建边界只使用模拟响应；错误必须保留定位且不能携带请求或服务端私有文本。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import test from 'node:test';
import user from '../e2e/cases/_shared/test-user.ts';
import wallet from '../e2e/cases/_shared/test-wallet.ts';
import { safeDiagnosticReason } from './request-failure.cjs';
import diagnostics from '../e2e/cases/_shared/account-diagnostics.ts';
import provision from '../e2e/cases/_shared/provision.ts';
import second from '../e2e/cases/_shared/second-account.ts';

const secret = 'https://user:synthetic-password@fixture.invalid:9443/private?token=synthetic-token 192.0.2.63 [2001:db8::63] Bearer synthetic-bearer Cookie: synthetic-cookie';
const userId = '11111111-2222-4333-8444-555555555555';
const credentials = { username: 'fixture01', password: 'synthetic-password' };
const account = { userId, accountUrl: `${user.stagingUserOrigin}/v11/user/${userId}/account`, authorization: 'synthetic-authorization' };
const boundaries = [
  { stage: '创建测试账号', operation: 'create-test-account', run: /** 调用真实注册边界。 */ () => user.createTestingAccount(credentials, 'synthetic-token'),
    result: { user_id: userId, username: credentials.username } },
  { stage: '设置创建账号钻石', operation: 'set-creation-diamonds', run: /** 调用真实设币边界。 */ () => wallet.setCreationDiamondBalance(account, 'synthetic-token'),
    result: { wallet_id: userId, currency_name: 'diamond', balance: '60' } },
];

for (const boundary of boundaries) {
  test(`${boundary.operation} 的响应、网络及解析失败保留真实状态且安全持久化`, /** 验证$\{boundary.operation\} 的响应、网络及解析失败保留真实状态且安全持久化。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
    const directory = await mkdtemp(join(tmpdir(), 'clrn-create-diagnostics-'));
    context.after(/** 测试结束后删除创建账号诊断的临时产物。 */ () => rm(directory, { recursive: true, force: true }));
    for (const [status, reason, reply] of [
      [500, 'http-error', /** 返回含敏感正文的 HTTP 500，验证错误信息脱敏。 */ () => new Response(secret, { status: 500 })],
      [200, 'invalid-json', /** 返回缺少业务结构的响应，验证无效结果处理。 */ () => new Response(secret)],
      [200, 'business-rejected', /** 返回含敏感原因的业务失败，验证诊断只保留安全字段。 */ () => Response.json({ ok: false, reason: secret })],
      [201, 'invalid-response', /** 返回状态 201 的异常业务结构，验证实际 HTTP 状态被保留。 */ () => Response.json({ ok: true, result: { diagnostic: secret } }, { status: 201 })],
      [200, 'body-read-failed', /** 提供正文读取会失败的合成响应。 */ () => ({ ok: true, status: 200, json: /** 注入正文读取失败。 */ async () => { throw new Error(secret); } })],
      ['unavailable', 'timeout', /** 注入含敏感信息的超时错误，验证超时分类与脱敏。 */ () => { throw Object.assign(new Error(secret), { name: 'TimeoutError' }); }],
      ['unavailable', 'connection-failed', /** 注入连接拒绝的嵌套原因，验证连接失败归因。 */ () => { throw new Error(secret, { cause: { code: 'ECONNREFUSED', message: secret } }); }],
      ['unavailable', 'request-failed', /** 注入未知底层原因，验证安全的请求失败兜底。 */ () => { throw new Error(secret, { cause: new Error(secret) }); }],
    ]) {
      let calls = 0;
      let failure;
      context.mock.method(globalThis, 'fetch', /** 统计账号请求并执行本次预设响应，约束请求次数。 */ async () => { calls++; return reply(); });
      await assert.rejects(boundary.run(), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param asyncError - 当前操作使用的 asyncError。 */ asyncError => {
        failure = asyncError;
        const message = `${boundary.stage}失败：method=POST operation=${boundary.operation} source=laiwan_proxy status=${status} response=${status === 'unavailable' ? 'not-received' : 'received'} reason=${reason}`;
        assert.equal(asyncError.message, message);
        assert.equal(asyncError.cause, undefined);
        const output = inspect(asyncError, { depth: 20 });
        assert.doesNotMatch(output, /fixture\.invalid|192\.0\.2\.63|2001:db8::63|9443|\/private|synthetic-|Bearer|Cookie/);
        assert.equal(safeDiagnosticReason(new Error(secret, { cause: asyncError })), message);
        const upper = diagnostics.accountPreparationError(new Error(secret, { cause: asyncError }), 'creation-account-setup');
        assert.equal(upper.message, message);
        assert.equal(upper.cause, undefined);
        return true;
      });
      assert.equal(calls, 1, '失败不得重试或当作成功');
      const summary = safeDiagnosticReason(failure);
      const terminal = [];
      context.mock.method(console, 'error', /** 收集日志文本，验证账号诊断只输出脱敏字段。
 * @param value - 当前待转换或校验的值。 */ value => terminal.push(String(value)));
      console.error(summary);
      assert.deepEqual(terminal, [summary]);
      await writeFile(join(directory, 'failure.json'), JSON.stringify({ summary }));
      assert.equal(JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')).summary, summary);
      assert.doesNotMatch(summary, /fixture\.invalid|192\.0\.2\.63|2001:db8::63|synthetic-/);
      context.mock.restoreAll();
    }
  });

  test(`${boundary.operation} 仍接受符合原契约的成功响应`, /** 验证$\{boundary.operation\} 仍接受符合原契约的成功响应。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
    context.mock.method(globalThis, 'fetch', /** 返回边界值结果，验证账号字段的类型校验。 */ async () => Response.json({ ok: true, result: boundary.result }));
    await boundary.run();
  });
}

test('响应中的不可转换余额仍保留200状态且不传播解析对象', /** 验证响应中的不可转换余额仍保留200状态且不传播解析对象。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  context.mock.method(globalThis, 'fetch', /** 返回无法安全转成数字的余额，验证异常对象不会进入诊断。 */ async () => Response.json({ ok: true, result: {
    wallet_id: userId, currency_name: 'diamond', balance: { toString: null, valueOf: null, diagnostic: secret },
  } }));
  await assert.rejects(wallet.setCreationDiamondBalance(account, 'synthetic-token'), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
    assert.match(error.message, /operation=set-creation-diamonds .*status=200 response=received reason=invalid-response$/);
    assert.doesNotMatch(inspect(error), /synthetic-|fixture\.invalid/);
    return true;
  });
});

test('非法账号地址不传播原生URL异常的私有input字段，也不发请求', /** 验证非法账号地址不传播原生URL异常的私有input字段，也不发请求。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', /** 统计请求并抛出敏感错误，验证失败不会触发额外请求。 */ async () => { calls++; throw new Error(secret); });
  const invalid = `not-a-url ${secret}`;
  assert.throws(/** 解析损坏的账号 URL，验证本地缓存契约失败。 */ () => diagnostics.parseAccountUrl(invalid), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
    assert.match(error.message, /method=LOCAL operation=creation-account-state .*status=unavailable response=not-received reason=invalid-response/);
    assert.doesNotMatch(inspect(error, { depth: 20 }), /fixture\.invalid|synthetic-|192\.0\.2\.63/);
    return true;
  });
  await assert.rejects(wallet.setCreationDiamondBalance({ ...account, accountUrl: invalid }, 'synthetic-token'),
    /method=LOCAL operation=creation-account-state .*status=unavailable/);
  assert.equal(calls, 0);
});

test('会话必须为200，其他实际状态和网络失败经过fixture传播后仍可定位', /** 验证会话必须为200，其他实际状态和网络失败经过fixture传播后仍可定位。 */ async () => {
  for (const status of [200, 201, 401, 500, undefined]) {
    let disposed = false;
    const page = { request: { get: /** 模拟会话请求边界。 */ async () => {
      if (status === undefined) throw new Error(secret, { cause: { code: 'ECONNRESET' } });
      return { status: /** 返回实际响应状态。 */ () => status,
        dispose: /** 记录响应释放。 */ async () => { disposed = true; } };
    } } };
    if (status === 200) await diagnostics.verifyAccountSession(page, account);
    else await assert.rejects(diagnostics.verifyAccountSession(page, account), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
      const upper = diagnostics.accountPreparationError(error, 'creation-account-session-check');
      assert.equal(upper.message, error.message);
      assert.match(upper.message, new RegExp(`method=GET operation=existing-account-session source=laiwan_proxy status=${status ?? 'unavailable'} response=${status === undefined ? 'not-received' : 'received'} reason=${status === undefined ? 'connection-failed' : status === 201 ? 'invalid-response' : 'http-error'}$`));
      assert.doesNotMatch(inspect(upper), /synthetic-|fixture\.invalid/);
      return true;
    });
    assert.equal(disposed, status !== undefined);
  }
});

test('未知本地准备错误不伪造请求或响应，不携带原始文本', /** 验证未知本地准备错误不伪造请求或响应，不携带原始文本。 */ () => {
  for (const operation of ['creation-account-setup', 'creation-account-state',
    'creation-account-session-check', 'creation-account-notices', 'second-account-setup', 'register-account-setup']) {
    const error = diagnostics.accountPreparationError(new Error(secret), operation);
    assert.match(error.message, new RegExp(`method=LOCAL operation=${operation} source=browser-(?:ui|state) status=unavailable response=not-received reason=request-failed$`));
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(inspect(error), /synthetic-|fixture\.invalid/);
  }
});

test('注册准备的未知失败关闭凭据页面后只输出安全阶段', /** 验证注册准备的未知失败关闭凭据页面后只输出安全阶段。 */ async () => {
  let pageClosed = false;
  const page = { context: /** 阻断所有真实浏览器或网络工作。 */ () => { throw new Error(secret); },
    close: /** 验证关闭密码页面。 */ async () => { pageClosed = true; } };
  await assert.rejects(provision.registerAccount(page), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
    assert.match(error.message, /method=LOCAL operation=register-account-setup .*status=unavailable/);
    assert.doesNotMatch(inspect(error), /synthetic-|fixture\.invalid/);
    return true;
  });
  assert.equal(pageClosed, true);
});

test('多用户准备保留注册500及本地失败定位，清理失败也不能泄露原异常', /** 验证多用户准备保留注册500及本地失败定位，清理失败也不能泄露原异常。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const originalToken = process.env.TESTING_API_TOKEN;
  process.env.TESTING_API_TOKEN = 'synthetic-token';
  context.after(/** 清理测试令牌环境变量，恢复用例运行前配置。 */ () => {
    if (originalToken === undefined) delete process.env.TESTING_API_TOKEN;
    else process.env.TESTING_API_TOKEN = originalToken;
  });
  for (const localFailure of [true, false]) {
    let closed = false;
    const browserContext = {
      newPage: /** 不启动真实页面。 */ async () => ({}),
      addInitScript: /** 在注册前注入本地准备错误。 */ async () => { if (localFailure) throw new Error(secret); },
      close: /** 清理错误同样可能包含私有文本。 */ async () => { closed = true; throw new Error(secret); },
    };
    const browser = { newContext: /** 返回隔离上下文。 */ async () => browserContext };
    context.mock.method(globalThis, 'fetch', /** 为子进程账号测试提供含敏感正文的 HTTP 500。 */ async () => new Response(secret, { status: 500 }));
    await assert.rejects(second.createSecondAccount(browser, null, false), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
      assert.match(error.message, localFailure
        ? /method=LOCAL operation=second-account-setup .*status=unavailable response=not-received/
        : /method=POST operation=create-test-account source=laiwan_proxy status=500 response=received reason=http-error/);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(inspect(error), /synthetic-|fixture\.invalid/);
      return true;
    });
    assert.equal(closed, true);
    context.mock.restoreAll();
  }
});
