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
  const failures = [new Response('', { status: 503 }), Response.json({ ok: false }),
    Response.json({ ok: true, result: { servers: ['node.invalid/path'] } }),
    Response.json({ ok: true, result: { servers: {} } })];
  try {
    for (const [index, response] of failures.entries()) {
      /** 返回当前损坏响应，不发起网络请求。 */
      globalThis.fetch = async () => response;
      await assert.rejects(mitmproxySources({ VISUAL_API_BASE_URL: `https://failed-${index}.invalid` }),
        { message: '读取 laiwan_prd 真实节点资料失败，未启动响应夹具' });
    }
    /** 模拟断连，底层错误不得进入公开报告。 */
    globalThis.fetch = async () => { throw new Error('包含连接资料的底层错误'); };
    await assert.rejects(mitmproxySources({ VISUAL_API_BASE_URL: 'https://disconnected.invalid' }),
      { message: '读取 laiwan_prd 真实节点资料失败，未启动响应夹具' });
  } finally { globalThis.fetch = fetch; }
});

test('离线来源必须明确输入且不发起真实请求', async () => {
  const input = { MITMPROXY_API_HOSTS: '["api.invalid"]', MITMPROXY_FEEDBACK_ORIGIN: 'https://feedback.invalid' };
  assert.equal(await mitmproxySources(input), input);
});
