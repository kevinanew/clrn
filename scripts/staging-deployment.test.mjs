import assert from 'node:assert/strict';
import test from 'node:test';
import { readDeploymentRecord, waitForDeployment } from './staging-deployment.mjs';

const expectedCommit = 'a'.repeat(40);
const previousCommit = 'b'.repeat(40);

/**
 * 返回包含真实构建版本格式的 HTML 响应。
 * @param commit - 模拟站点正在提供的应用提交。
 */
function pageResponse(commit) {
  return new Response(`<html><head><meta name="build-version" content="${commit} - 2026-10-14T00:00:00.000Z" /></head></html>`);
}

test('部署记录只接受 staging、完整提交和有效时间', () => {
  const record = { environment: 'staging', sha: expectedCommit, deployed_at: '2026-10-14T00:00:00Z' };
  assert.equal(readDeploymentRecord(JSON.stringify(record)), expectedCommit);
  for (const value of [null, {}, { ...record, environment: 'production' }, { ...record, sha: 'abc1234' },
    { ...record, deployed_at: '' }, { ...record, deployed_at: 1 }]) {
    assert.throws(() => readDeploymentRecord(JSON.stringify(value)));
  }
});

test('先读到旧版本时等待，实际提供目标提交后才放行', async () => {
  let elapsed = 0;
  const requests = [];
  const result = await waitForDeployment({ expectedCommit, now: /** 返回模拟时钟。 */ () => elapsed,
    wait: /**
     * 推进模拟时间。
     * @param milliseconds - 等待毫秒数。
     */ async milliseconds => { elapsed += milliseconds; }, log: /** 测试时不输出轮询信息。 */ () => {},
    fetcher: /**
     * 记录网络边界请求。
     * @param url - 请求地址。
     * @param options - 请求选项。
     */ async (url, options) => {
      requests.push({ url: String(url), options });
      return pageResponse(requests.length === 1 ? previousCommit : expectedCommit);
    } });
  assert.equal(result, expectedCommit);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].url, requests[1].url);
  assert.equal(requests[0].options.redirect, 'error');
  assert.match(requests[0].options.headers['Cache-Control'], /no-store/);
  assert.equal(elapsed, 10000);
});

test('测试结束后的单次校验拒绝其他部署，无等待或成功回退', async () => {
  let requested = 0;
  await assert.rejects(waitForDeployment({ expectedCommit, maximumWaitMilliseconds: 0,
    fetcher: /** 返回当前网络边界响应。 */ async () => { requested += 1; return pageResponse(previousCommit); },
    wait: /** 确认单次校验不等待。 */ async () => { assert.fail('单次校验不应等待'); } }), /版本不匹配/);
  assert.equal(requested, 1);
});

test('站点成功返回目标版本前，错误状态、无效 HTML 和网络失败不能放行', async () => {
  let elapsed = 0;
  let attempts = 0;
  const result = await waitForDeployment({ expectedCommit, now: /** 返回模拟时钟。 */ () => elapsed,
    wait: /**
     * 推进模拟时间。
     * @param milliseconds - 等待毫秒数。
     */ async milliseconds => { elapsed += milliseconds; }, log: /** 测试时不输出轮询信息。 */ () => {},
    fetcher: /** 返回当前网络边界响应。 */ async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('连接失败');
      if (attempts === 2) return new Response('', { status: 503 });
      if (attempts === 3) return new Response('<html>旧入口</html>');
      return pageResponse(expectedCommit);
    } });
  assert.equal(result, expectedCommit);
  assert.equal(attempts, 4);
});

test('站点一直没有目标版本时有界超时', async () => {
  let elapsed = 0;
  await assert.rejects(waitForDeployment({ expectedCommit, maximumWaitMilliseconds: 25000,
    now: /** 返回模拟时钟。 */ () => elapsed, wait: /**
     * 推进模拟时间。
     * @param milliseconds - 等待毫秒数。
     */ async milliseconds => { elapsed += milliseconds; }, log: /** 测试时不输出轮询信息。 */ () => {},
    fetcher: /** 返回当前网络边界响应。 */ async () => pageResponse(previousCommit) }), /版本不匹配/);
  assert.equal(elapsed, 25000);
});

test('拒绝正式站、任意主机、非 HTTPS 和无效版本，且不访问网络', async () => {
  for (const baseUrl of ['https://h5.laiwan.life/', 'http://h5.page.shafayouxi.org/',
    'https://example.com/', 'https://user:password@h5.page.shafayouxi.org/']) {
    await assert.rejects(waitForDeployment({ expectedCommit, baseUrl,
      fetcher: /** 返回当前网络边界响应。 */ async () => { assert.fail('不允许访问这个站点'); } }), /staging/);
  }
  await assert.rejects(waitForDeployment({ expectedCommit: 'abc1234' }), /40 位/);
});
