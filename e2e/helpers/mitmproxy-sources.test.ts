import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { mitmproxySources } from './mitmproxy-sources';

test('代理只使用真实节点资料中的确切来源和本轮发布包的反馈分支', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'proxy-sources-'));
  const fetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    const scripts = path.join(directory, '_expo/static/js/web');
    await mkdir(scripts, { recursive: true });
    await writeFile(path.join(scripts, 'index-fixture.js'),
      'testID:"feedback-user-report-screen",uri:config.isStagingEnvironment()?\'https://feedback.invalid/form/\':\'https://other.invalid/form/\'');
    /**
     * 模拟只读节点资料，验证请求参数。
     * @param address - 当前请求地址。
     * @param options - 请求限制。
     */
    globalThis.fetch = async (address, options) => {
      calls.push(String(address));
      assert.equal(options?.method, 'POST', '节点资料使用只读 POST，GET 会被真实服务拒绝');
      assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' });
      assert.equal(options?.body, undefined, '节点发现不携带账号、令牌或业务写入数据');
      assert.equal(options?.redirect, 'error', '真实节点读取必须拒绝重定向');
      return Response.json({ ok: true, result: { servers: { 'node-a.invalid': '不保存地址', 'node-b.invalid': '不保存地址' } } });
    };
    const input = { VISUAL_API_BASE_URL: 'https://root.invalid', CLRN_RELEASE_WEB_ROOT: directory };
    const configured = await mitmproxySources(input);
    assert.deepEqual(JSON.parse(configured.MITMPROXY_API_HOSTS!), ['root.invalid', 'node-a.invalid', 'node-b.invalid']);
    assert.equal(configured.MITMPROXY_FEEDBACK_ORIGIN, 'https://feedback.invalid');
    assert.deepEqual(calls, ['https://root.invalid/public/v13/metadata/servers']);
    assert.deepEqual(await mitmproxySources(input), configured, '同轮代理复用只读资料，不重复请求');
  } finally {
    globalThis.fetch = fetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('节点失败或契约损坏时拒绝启动夹具且错误不包含来源', async () => {
  const fetch = globalThis.fetch;
  const failures = [
    { response: new Response('', { status: 405 }), reason: 'HTTP 405' },
    { response: new Response('', { status: 503 }), reason: 'HTTP 503' },
    { response: new Response('包含私有连接资料的非 JSON 正文'), reason: 'JSON 解析失败' },
    { response: Response.json({ ok: false }), reason: '节点契约无效' },
    { response: Response.json({ ok: true, result: { servers: ['node.invalid/path'] } }), reason: '节点主机无效' },
    { response: Response.json({ ok: true, result: { servers: {} } }), reason: '节点主机无效' },
  ];
  try {
    for (const [index, { response, reason }] of failures.entries()) {
      /** 返回当前损坏响应，不发起网络请求。 */
      globalThis.fetch = async () => response;
      await assert.rejects(mitmproxySources({ VISUAL_API_BASE_URL: `https://failed-${index}.invalid` }),
        { message: `读取 laiwan_prd 真实节点资料失败（${reason}），未启动响应夹具` });
    }
    /** 模拟断连，底层错误不得进入公开报告。 */
    globalThis.fetch = async () => { throw new Error('包含连接资料的底层错误'); };
    await assert.rejects(mitmproxySources({ VISUAL_API_BASE_URL: 'https://disconnected.invalid' }),
      { message: '读取 laiwan_prd 真实节点资料失败（传输失败），未启动响应夹具' });
  } finally { globalThis.fetch = fetch; }
});

test('同轮并发共享失败但不自动重试，后续独立初始化重新读取真实资料', async () => {
  const fetch = globalThis.fetch;
  let calls = 0;
  const input = { VISUAL_API_BASE_URL: 'https://independent.invalid' };
  try {
    /** 首次读取失败，后续独立调用提供有效节点资料。 */
    globalThis.fetch = async () => {
      calls++;
      return calls === 1 ? new Response('', { status: 405 })
        : Response.json({ ok: true, result: { servers: { 'node.invalid': '192.0.2.1' } } });
    };
    const failed = await Promise.allSettled([mitmproxySources(input), mitmproxySources(input)]);
    assert.ok(failed.every(result => result.status === 'rejected'), '失败不得伪装成成功或自动恢复');
    assert.equal(calls, 1, '并发调用共享同次读取，失败后没有自动重试');
    const configured = await mitmproxySources(input);
    assert.equal(calls, 2, '后续独立初始化不能永久沿用旧失败');
    assert.deepEqual(JSON.parse(configured.MITMPROXY_API_HOSTS!), ['independent.invalid', 'node.invalid']);
    assert.ok(!configured.MITMPROXY_API_HOSTS!.includes('192.0.2.1'), '主机列表只取契约中的主机键');
    assert.deepEqual(await mitmproxySources(input), configured);
    assert.equal(calls, 2, '成功资料继续缓存');
  } finally { globalThis.fetch = fetch; }
});

test('离线来源必须明确输入且不发起真实请求', async () => {
  const input = { MITMPROXY_API_HOSTS: '["api.invalid"]', MITMPROXY_FEEDBACK_ORIGIN: 'https://feedback.invalid' };
  assert.equal(await mitmproxySources(input), input);
});
