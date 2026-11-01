/** 隔离登录和钱包边界，确认上层失败与持久化仍保留定位，不使用真实账号或业务接口。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import test from 'node:test';
import type { Page, BrowserContext } from '@playwright/test';
import { accountStatus, signIn } from './auth';
import { readDiamondBalance } from './provision';
import { prepareReadAccount, readAccountPreparationError } from './read-account-fixture';
import { openHall } from './page';
import { environment } from '../../helpers/environment';

const secret = 'https://user:synthetic-password@account.invalid:9443/private?token=synthetic-token 192.0.2.60 [2001:db8::60] Bearer synthetic-bearer Cookie: synthetic-cookie';
const session = { userId: 'synthetic-user', accountUrl: 'https://account.invalid/account', authorization: 'Bearer synthetic-token' };

/**
 * 验证实际边界及 fixture 上层传播后的状态、阶段、无 cause 与凭据负例。
 * @param error - 请求边界转换过的错误。
 * @param stage - 代码中固定的业务阶段。
 * @param method - 实际请求方法。
 * @param operation - 固定操作标识。
 * @param status - 实际响应状态或明确无响应。
 * @param reason - 本例确定的固定错误类别。
 * @param source - 固定表内的逻辑来源。
 */
function checkFailure(error: unknown, stage: string, method: string, operation: string,
  status: number | 'unavailable', reason: string, source = 'laiwan_prd'): boolean {
  assert.ok(error instanceof Error);
  const upper = readAccountPreparationError(new Error(secret, { cause: error }));
  assert.equal(upper.message, `${stage}失败：method=${method} operation=${operation} source=${source} status=${status} response=${status === 'unavailable' ? 'not-received' : 'received'} reason=${reason}`);
  for (const failure of [error, upper]) {
    assert.equal(failure.cause, undefined);
    assert.doesNotMatch(inspect(failure, { depth: 20 }), /account\.invalid|192\.0\.2\.60|2001:db8::60|9443|\/private|synthetic-|Bearer|Cookie|Call log/);
  }
  return true;
}

/** 模拟已就绪的 UI 定位器；本文件只验证网络边界，不声称真实页面通过。 */
class Locator {
  _apiName = 'Locator';
  /** 返回唯一定位器。 */
  filter() { return this; }
  /** 合并已就绪的大厅和提示定位器。 */
  or() { return this; }
  /** 返回当前目标。 */
  first() { return this; }
  /** 本例没有 staging 提示。 */
  async isVisible() { return false; }
  /** 表单元素已就绪。 */
  async _expect() { return { matches: true, received: 1, log: [] }; }
  /** 输入只存在于本例内存。 */
  async fill() {}
  /** 模拟用户点击，网络结果由独立边界注入。 */
  async click() {}
}

test('入口健康检查仍拒绝500和无响应；收到200后的页面错误不能丢失实际导航状态', async () => {
  for (const [status, brokenUi, reason] of [[500, false, 'http-error'],
    [undefined, false, 'timeout'], [200, true, 'invalid-response'], [200, false, null]] as const) {
    const page = {
      goto: /** 注入真实导航边界的响应或失败形态。 */ async () => {
        if (status === undefined) throw Object.assign(new Error(secret), { name: 'TimeoutError' });
        return { ok: /** 保持HTTP成功要求。 */ () => status === 200,
          status: /** 返回已收到的状态。 */ () => status };
      },
      getByTestId: /** 模拟已就绪大厅或抛出未知页面错误。 */ () => {
        if (brokenUi) throw new Error(secret);
        return new Locator();
      },
    } as unknown as Page;
    if (reason) await assert.rejects(openHall(page), error => checkFailure(error,
      '打开功能测试大厅', 'GET', 'functional-open-hall', status ?? 'unavailable', reason, 'web-entry'));
    else await openHall(page);
  }
});

test('已有账号登录失败保留真实定位；200和完整缓存成功时仍返回原会话', async () => {
  for (const [status, failure, reason] of [
    [500, null, 'http-error'],
    [undefined, new Error(`apiRequestContext.post: socket hang up\nCall log:\n - ${secret}`), 'connection-failed'],
    [undefined, Object.assign(new Error(secret), { name: 'TimeoutError' }), 'timeout'],
    [200, new SyntaxError(secret), 'invalid-response'],
    [200, null, null],
  ] as const) {
    let closed = false;
    let registrationBlocked = false;
    const response = { status: /** 返回模拟响应状态。 */ () => status,
      ok: /** 按状态判断成功。 */ () => status === 200,
      url: /** 保留地址只在进程内用于派生会话接口。 */ () => 'https://account.invalid/public/v10/user/login/username/password' };
    const page = {
      route: /** 确认自动注册阻断仍被安装。
       * @param pattern - 原有禁止注册的路径。
       */ async (pattern: string) => { registrationBlocked = pattern === '**/public/v11/user/register/**'; },
      on: /** 本例显式观察到登录POST。
       * @param event - 请求事件。
       * @param listener - 仅接收本例请求。
       */ (event: string, listener: (request: { method: () => string; url: () => string }) => void) => {
        listener({ method: /** 观察到实际POST。 */ () => 'POST', url: /** 保留地址只用于本地匹配。 */ () => response.url() });
      },
      off: /** 退出时解除本例请求观察。 */ () => {},
      getByTestId: /** 提供隔离表单。 */ () => new Locator(),
      waitForResponse: /** 注入响应或真实错误形态。 */ async () => {
        if (status === undefined) throw failure;
        return response;
      },
      evaluate: /** 模拟收到200后读取完整或损坏缓存。 */ async () => { if (failure) throw failure; return session; },
      close: /** 失败时关闭密码表单。 */ async () => { closed = true; },
    } as unknown as Page;
    const login = signIn(page, { username: 'synthetic-user', password: 'synthetic-password' });
    if (reason) await assert.rejects(login,
      error => checkFailure(error, '已有只读账号登录', 'POST', 'existing-account-login', status ?? 'unavailable', reason));
    else assert.deepEqual(await login, { ...session, accountUrl: 'https://account.invalid/v11/user/synthetic-user/account' });
    assert.equal(closed, Boolean(reason));
    assert.ok(registrationBlocked);
  }
});

test('表单准备失败或未观察到登录请求不能虚构POST；观察到请求后才记录POST及无响应', async () => {
  for (const phase of ['form', 'waiting', 'request'] as const) {
    let closed = false;
    let detached = false;
    const timeout = Object.assign(new Error(secret), { name: 'TimeoutError' });
    const page = {
      route: /** 不发出任何注册请求。 */ async () => {},
      getByTestId: /** 在表单边界注入故障，其余分支继续到响应等待。 */ () => {
        if (phase === 'form') throw timeout;
        return new Locator();
      },
      on: /** 仅request分支注入确已观察到的POST。
       * @param event - 监听的事件。
       * @param listener - 请求观察回调。
       */ (event: string, listener: (request: { method: () => string; url: () => string }) => void) => {
        if (phase === 'request') listener({ method: /** 观察到实际POST。 */ () => 'POST', url: /** 使用保留域名的固定登录路径。 */ () => 'https://account.invalid/public/v10/user/login/username/password' });
      },
      off: /** 无论失败阶段都解除观察。 */ () => { detached = true; },
      waitForResponse: /** 未收到任何HTTP响应。 */ async () => { throw timeout; },
      close: /** 失败必须关闭凭据表单。 */ async () => { closed = true; },
    } as unknown as Page;
    const operation = phase === 'form' ? 'existing-account-login-ui'
      : phase === 'waiting' ? 'existing-account-login-await' : 'existing-account-login';
    const stage = phase === 'form' ? '准备已有只读账号登录表单'
      : phase === 'waiting' ? '等待已有只读账号登录响应（请求未观察到）' : '已有只读账号登录';
    await assert.rejects(signIn(page, { username: 'synthetic-user', password: 'synthetic-password' }),
      error => checkFailure(error, stage, phase === 'form' ? 'LOCAL' : phase === 'waiting' ? 'UNKNOWN' : 'POST',
        operation, 'unavailable', 'timeout', phase === 'request' ? 'laiwan_prd' : 'browser-ui'));
    assert.ok(closed);
    assert.ok(detached);
  }
});

test('实际只读fixture准备链保留本地阶段与真实会话状态，仍要求200并关闭失败页面', async () => {
  for (const phase of ['context', 'origin', 'session-401', 'session-503', 'session-201', 'success'] as const) {
    let closed = false;
    let walletReads = 0;
    const status = phase === 'session-401' ? 401 : phase === 'session-503' ? 503 : phase === 'session-201' ? 201 : 200;
    const page = {
      goto: /** 成功的隔离入口导航。 */ async () => ({ ok: /** HTTP成功。 */ () => true, status: /** 已收到200。 */ () => 200 }),
      getByTestId: /** 本例UI均已就绪。 */ () => new Locator(),
      url: /** 来源错误只使用保留域名，其他分支读取现有配置但不连接。 */ () => phase === 'origin' ? 'https://account.invalid/' : environment.stagingUrl,
      route: /** 保留自动注册阻断。 */ async () => {},
      on: /** 本例由已观察到的响应确认POST。 */ () => {},
      off: /** 解除观察。 */ () => {},
      waitForResponse: /** 成功的隔离登录响应。 */ async () => ({ ok: /** HTTP成功。 */ () => true, status: /** 已收到200。 */ () => 200, url: /** 合成会话地址。 */ () => session.accountUrl }),
      evaluate: /** 返回合成会话。 */ async () => session,
      request: {
        get: /** 会话状态保持实际输入，不自动接受非200。 */ async () => ({ status: /** 已收到指定状态。 */ () => status, dispose: /** 释放响应。 */ async () => {} }),
        put: /** 只有会话200后才能读取钱包。 */ async () => {
          walletReads++;
          return { ok: /** HTTP成功。 */ () => true, status: /** 已收到200。 */ () => 200,
            json: /** 解析隔离响应。 */ async () => ({ ok: true, result: { currencies: [{ code: 'diamond', balance: '73' }] } }), dispose: /** 释放响应。 */ async () => {} };
        },
      },
      close: /** 所有失败都关闭页面。 */ async () => { closed = true; },
    } as unknown as Page;
    const context = { addInitScript: /** 注入未知的本地准备错误。 */ async () => {
      if (phase === 'context') throw new Error(secret);
    } } as unknown as BrowserContext;
    const result = prepareReadAccount(page, context);
    if (phase === 'success') {
      assert.equal((await result).diamondBalance, 73);
      assert.equal(walletReads, 1);
      assert.equal(closed, false);
    } else {
      await assert.rejects(result, error => checkFailure(error,
        phase === 'context' ? '准备已有只读账号页面' : phase === 'origin' ? '核对只读账号页面来源' : '核对已有只读账号会话',
        phase === 'context' || phase === 'origin' ? 'LOCAL' : 'GET',
        phase === 'context' ? 'existing-account-setup' : phase === 'origin' ? 'existing-account-origin' : 'existing-account-session',
        phase === 'context' || phase === 'origin' ? 'unavailable' : status,
        phase === 'context' || phase === 'origin' ? 'request-failed' : status === 201 ? 'invalid-response' : 'http-error',
        phase === 'context' || phase === 'origin' ? 'browser-ui' : 'laiwan_prd'));
      assert.equal(walletReads, 0);
      assert.ok(closed);
    }
  }
});

test('会话网络错误传播保留无响应；200、401及503仍返回实际状态且不改变原重试配置', async () => {
  for (const status of [undefined, 200, 401, 503]) {
    let disposed = false;
    const page = { request: { get: /** 保留原请求及有限连接重置重试。
     * @param url - 原会话地址。
     * @param options - 原有认证、超时和重试。
     */ async (url: string, options: { maxRetries: number; timeout: number; headers: { Authorization: string } }) => {
      assert.equal(url, session.accountUrl);
      assert.equal(options.maxRetries, 2);
      assert.equal(options.timeout, 15000);
      assert.equal(options.headers.Authorization, session.authorization);
      if (status === undefined) throw new Error(`apiRequestContext.get: socket hang up\nCall log:\n - ${secret}`);
      return { status: /** 返回实际状态。 */ () => status,
        dispose: /** 记录响应释放。 */ async () => { disposed = true; } };
    } } } as unknown as Page;
    if (status === undefined) {
      await assert.rejects(accountStatus(page, session), error => checkFailure(error,
        '核对已有只读账号会话', 'GET', 'existing-account-session', 'unavailable', 'connection-failed'));
    } else {
      assert.equal(await accountStatus(page, session), status);
      assert.ok(disposed);
    }
  }
});

test('钱包HTTP500、解析失败、业务拒绝及契约损坏仍失败，成功时返回真实余额', async () => {
  for (const [status, body, reason] of [[500, secret, 'http-error'], [201, secret, 'invalid-json'],
    [200, { ok: false, reason: secret, errors: { detail: secret } }, 'business-rejected'],
    [200, { ok: true, result: { currencies: secret } }, 'invalid-response'],
    [200, { ok: true, result: { currencies: [{ code: 'diamond', balance: secret }] } }, 'invalid-response'],
    [200, { ok: true, result: { currencies: [{ code: 'diamond', balance: { toString: secret, valueOf: secret } }] } }, 'invalid-response'],
    [200, { ok: true, result: { currencies: [{ code: 'diamond', balance: '73' }] } }, null]] as const) {
    let disposed = false;
    const page = { request: { put: /** 注入隔离钱包响应。 */ async () => ({
      status: /** 返回实际状态。 */ () => status,
      ok: /** 保持原有HTTP成功标准。 */ () => status < 300,
      json: /** 注入正文或解析失败。 */ async () => { if (typeof body === 'string') throw new SyntaxError(body); return body; },
      dispose: /** 保持释放失败响应。 */ async () => { disposed = true; },
    }) } } as unknown as Page;
    if (reason) await assert.rejects(readDiamondBalance(page, session), error => checkFailure(error,
      '读取已有只读账号钱包', 'PUT', 'existing-account-wallet', status, reason));
    else assert.equal(await readDiamondBalance(page, session), 73);
    assert.ok(disposed);
  }
  const page = { request: { put: /** 注入未收到响应的未知错误。 */ async () => { throw new Error(secret, { cause: new Error(secret) }); } } } as unknown as Page;
  await assert.rejects(readDiamondBalance(page, session), error => checkFailure(error,
    '读取已有只读账号钱包', 'PUT', 'existing-account-wallet', 'unavailable', 'request-failed'));
});

test('只读账号上层持久化不保存包装文本，未知页面错误仍保留准备阶段而不推断HTTP状态', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'clrn-read-account-diagnostics-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const error = readAccountPreparationError(new Error(`HTTP 503 ${secret}`, { cause: new Error(secret) }));
  assert.equal(error.message, '准备已有只读账号页面失败：method=LOCAL operation=existing-account-setup source=browser-ui status=unavailable response=not-received reason=request-failed');
  const outputs: string[] = [];
  context.mock.method(console, 'error', (value: string) => outputs.push(value));
  console.error(error.message);
  const report = join(directory, 'failure.json');
  await writeFile(report, JSON.stringify({ error: error.message, detail: inspect(error) }));
  outputs.push(await readFile(report, 'utf8'));
  for (const output of outputs) {
    assert.ok(output.includes(error.message));
    assert.doesNotMatch(output, /account\.invalid|synthetic-|192\.0\.2\.60|2001:db8::60|HTTP 503/);
  }
  const page = { request: { get: /** 注入无顶层code的真实断连形态。 */ async () => {
    throw new Error(`apiRequestContext.get: socket hang up\nCall log:\n - ${secret}`);
  } } } as unknown as Page;
  const failure = await accountStatus(page, session).catch(error => readAccountPreparationError(new Error(secret, { cause: error })));
  assert.ok(failure instanceof Error);
  await writeFile(report, JSON.stringify({ error: failure.message, detail: inspect(failure) }));
  console.error(failure.message);
  for (const output of [outputs.at(-1)!, await readFile(report, 'utf8')]) {
    assert.ok(output.includes('method=GET operation=existing-account-session source=laiwan_prd status=unavailable response=not-received reason=connection-failed'));
    assert.doesNotMatch(output, /account\.invalid|synthetic-|192\.0\.2\.60|2001:db8::60|Call log/);
  }
});
