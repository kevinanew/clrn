/** 真实辅助函数在模拟网络边界上的错误传播，以及终端、文件和报告附件的脱敏。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { APIRequestContext, BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { ensureRoomBalance, deletePrivateGameRoom, createPrivateGameRoom } from '../../cases/_shared/room';
import { enterTexasRoom } from '../../cases/texas-holdem/room';
import { installConnectionDiagnostics } from './connectionDiagnostics';
import { requestErrorSummary, requestFailure } from './requestError';

const secret = 'https://user:synthetic-password@diagnostic.invalid:9443/private 192.0.2.40 [2001:db8::40] Bearer synthetic-bearer Cookie: sid=synthetic-cookie';
const account = { userId: '11111111-2222-4333-8444-555555555555', username: 'fixture01', authorization: 'Bearer synthetic-auth' };
const room = { roomId: account.userId, apiOrigin: 'https://diagnostic.invalid', authorization: account.authorization };

/**
 * 检查输出不含任何合成连接入口、响应字段或凭据。
 * @param output - 终端、附件或文件内容。
 */
function privateOutput(output: string) {
  for (const value of ['diagnostic.invalid', '192.0.2.40', '2001:db8::40', '9443', '/private', 'synthetic-']) {
    assert.ok(!output.includes(value), value);
  }
}

test('余额和观察者上层不传播地址、任意响应头、业务文本或嵌套 cause，保留 HTTP 状态', async () => {
  for (const operation of ['room-read-diamonds', 'texas-enter']) {
    for (const [status, body, reason] of [[500, secret, 'http-error'], [201, secret, 'invalid-json'],
      [200, { ok: false, reason: secret, errors: { [secret]: secret } }, 'business-rejected']] as const) {
      let disposed = false;
      const response = { status: /** 返回本例真实状态。 */ () => status, ok: /** 按状态判断成功。 */ () => status < 300,
        headers: /** 注入不可信头。 */ () => ({ 'content-type': secret }), url: /** 注入保留地址。 */ () => secret,
        json: /** 注入解析结果。 */ async () => { if (typeof body === 'string') throw new SyntaxError(body); return body; },
        dispose: /** 记录响应释放。 */ async () => { disposed = true; } };
      const request = { put: /** 返回隔离响应。 */ async () => response } as unknown as APIRequestContext;
      await assert.rejects(operation === 'texas-enter' ? enterTexasRoom({ request }, room) : ensureRoomBalance(request, account), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`operation=${operation} source=laiwan_prd status=${status} .*reason=${reason}`));
        privateOutput(error.stack || '');
        return true;
      });
      assert.equal(disposed, true);
    }
    const request = { put: /** 注入网络失败。 */ async () => { throw new Error(secret, { cause: new Error(secret) }); } } as unknown as APIRequestContext;
    await assert.rejects(operation === 'texas-enter' ? enterTexasRoom({ request }, room) : ensureRoomBalance(request, account), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /status=unavailable response=not-received/);
      privateOutput(error.stack || '');
      return true;
    });
  }
});

test('清理仍拒绝 HTTP500、业务失败、非 JSON 和无响应，不能误报成功', async context => {
  for (const reply of [new Response(secret, { status: 500 }), new Response(secret),
    Response.json({ ok: false, reason: secret }), new Error(secret, { cause: new Error(secret) })]) {
    context.mock.method(globalThis, 'fetch', async () => { if (reply instanceof Error) throw reply; return reply; });
    await assert.rejects(deletePrivateGameRoom(room), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /method=DELETE operation=room-delete source=laiwan_prd status=/);
      privateOutput(error.stack || '');
      return true;
    });
    context.mock.restoreAll();
  }
});

test('深层 cause 上层包装后，终端、持久化 JSON/Markdown 和报告附件仍保留安全请求定位', async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-error-report-'));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const events = new EventEmitter();
  const page = events as unknown as Page;
  const browser = { exposeBinding: /** 无浏览器绑定副作用。 */ async () => {}, addInitScript: /** 无浏览器注入副作用。 */ async () => {} } as unknown as BrowserContext;
  const attachments: string[] = [];
  const terminal: string[] = [];
  context.mock.method(console, 'log', (value: unknown) => terminal.push(String(value)));
  const info = { title: 'isolated-request', project: { name: 'offline' }, repeatEachIndex: 0, retry: 0,
    outputPath: /** 返回本例临时文件。
 * @param name - 输出文件名。
 */ (name: string) => path.join(directory, name),
    attach: /** 保存实际报告附件用于检查。
 * @param _name - 附件名。
 * @param options - 附件文件或正文。
 */ async (_name: string, options: { path?: string; body?: string }) => {
      attachments.push(options.path ? await readFile(options.path, 'utf8') : options.body || '');
    } } as unknown as TestInfo;
  const diagnostic = await installConnectionDiagnostics(browser, page, info, { diagnostics: /** 注入不可信代理诊断。 */ async () => ({ dropped: 0,
    events: [{ event: 'proxy.error', reason: secret, status: 500, method: 'POST', operation: 'room-create' }] }) });
  const request = { url: /** 静态路径和查询也不能进入新加的资源日志。 */ () => `${secret.split(' ')[0]}/asset.webp`,
    method: /** 固定资源方法。 */ () => 'GET', resourceType: /** 模拟静态资源。 */ () => 'image',
    failure: /** 注入底层失败文本。 */ () => ({ errorText: secret }) } as unknown as Request;
  events.emit('request', request);
  events.emit('response', { request: /** 关联原始请求。 */ () => request, status: /** 返回已收到状态。 */ () => 206, fromServiceWorker: /** 无 Service Worker。 */ () => false });
  events.emit('requestfailed', request);
  const noResponse = { ...request, url: /** 模拟未收到响应的独立请求。 */ () => 'https://diagnostic.invalid/resource' } as Request;
  events.emit('request', noResponse);
  events.emit('requestfailed', noResponse);
  for (const failure of [requestFailure('room-create', 'http-error', 500),
    new Error(requestErrorSummary(new Error(`apiRequestContext.post: connect ECONNREFUSED ${secret}\nCall log:\n - ${secret}`), 'room-create'))]) {
    attachments.length = 0;
    terminal.length = 0;
    await diagnostic.save(new Error(secret, { cause: new Error(secret, { cause: failure }) }));
    const json = await readFile(path.join(directory, 'connection-diagnostics.json'), 'utf8');
    const markdown = await readFile(path.join(directory, 'connection-summary.md'), 'utf8');
    const failed = JSON.parse(json).events.filter((event: { event: string }) => event.event === 'http.failed');
    assert.equal(failed[0].status, 206, '收到响应后中断不能丢失原状态');
    assert.equal(failed[0].response, 'received');
    assert.equal(failed[1].status, 'unavailable');
    assert.equal(failed[1].response, 'not-received');
    assert.ok(terminal.length > 0);
    assert.ok(attachments.length > 0);
    for (const output of [json, markdown, ...attachments, ...terminal]) {
      privateOutput(output);
      assert.ok(output.includes(failure.message));
    }
  }
  privateOutput(requestErrorSummary(new Error(secret), 'room-create'));
});


test('读取建房会话失败或包含合成凭据的损坏 JSON 不能传播原始文本', async () => {
  for (const failEvaluation of [false, true]) {
    const page = { evaluate: /** 注入缓存或底层失败。 */ async () => {
      if (failEvaluation) throw new Error(secret);
      return secret;
    } } as unknown as Page;
    await assert.rejects(createPrivateGameRoom(page, () => {}, 'texas_react_native'), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /operation=room-read-session source=laiwan_prd status=unavailable/);
      privateOutput(error.stack || '');
      return true;
    });
  }
});
