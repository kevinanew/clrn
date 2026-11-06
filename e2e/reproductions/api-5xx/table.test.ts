/** 房间清理失败必须保留非零退出结果，并从异常及实际 reporter 中移除认证头。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import type { APIResponse } from '@playwright/test';
import { deleteTable } from './table';

const secret = 'synthetic-cleanup-bearer-secret';
const roomId = '11111111-1111-4111-8111-111111111111';

/**
 * 检查最终错误可安全持久化且保留正确的失败阶段。
 * @param error - 清理边界转换后的错误。
 */
function safeFailure(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.cause, undefined);
  assert.match(error.message, /operation=room-delete /);
  assert.ok(!inspect(error, { depth: 10 }).includes(secret));
  assert.doesNotMatch(error.message, /Call log|Authorization|127\.0\.0\.1/);
  return true;
}

test('清理传输异常只传播安全错误，超时和连接异常均保持失败', /** 核对三种真实 Playwright 异常形态的最终诊断。 */ async () => {
  for (const firstLine of ['Timeout 15000ms exceeded', 'connect ECONNREFUSED 127.0.0.1:1', 'socket hang up']) {
    const request = {
      /** 在请求适配器边界抛出含合成认证头的原始异常。 */
      async delete() { throw new Error(`apiRequestContext.delete: ${firstLine}\nCall log:\n  - Authorization: Bearer ${secret}`); },
    };
    await assert.rejects(deleteTable(request, `Bearer ${secret}`, roomId), safeFailure);
  }
});

test('正文及响应释放异常同样脱敏，正文失败也必须尝试释放', /** 验证清理读取与释放的失败结果及资源回收。 */ async () => {
  for (const failure of ['body', 'dispose', 'both']) {
    let disposed = false;
    const response = {
      /** 本例已经收到清理接口的实际状态。 */
      status: () => 200,
      /** 正文和释放检查只针对已有响应，不模拟其他业务故障。 */
      ok: () => true,
      /** 模拟读取层可能携带不可信正文的异常。 */
      async json() {
        if (failure !== 'dispose') throw new Error(secret);
        return { ok: true };
      },
      /** 即使正文读取失败，也记录并验证释放尝试。 */
      async dispose() {
        disposed = true;
        if (failure !== 'body') throw new Error(secret);
      },
    } as APIResponse;
    const request = {
      /** 把已有响应交给真实清理实现验证读取和释放边界。 */
      async delete() { return response; },
    };
    await assert.rejects(deleteTable(request, `Bearer ${secret}`, roomId), safeFailure);
    assert.equal(disposed, true);
  }
});

test('锁定版本 Playwright 拒绝清理失败、空白提示和页面异常，报告不含令牌', /** 运行真实 runner 和 reporter，验证最终失败结果及落盘脱敏。
 * @param context - 用于明确报告本机权限限制。 */ async context => {
  const e2e = path.resolve(__dirname, '../..');
  const output = path.join(e2e, 'test-results');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'api-5xx-cleanup-'));
  try {
    const report = path.join(directory, 'results.json');
    const boundary = path.join(directory, 'boundary.json');
    await writeFile(path.join(directory, 'cleanup.spec.ts'), `
import { writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { test } from '@playwright/test';
import { deleteTable } from ${JSON.stringify(path.join(__dirname, 'table.ts'))};
import { expectReadableError, withNoPageErrors } from ${JSON.stringify(path.join(__dirname, 'buy-in.ts'))};
test('cleanup transport failure', async ({ request }) => {
  const transport = { delete: (_url, options) => request.delete('http://127.0.0.1:1', options).catch(error => {
    writeFileSync(${JSON.stringify(boundary)}, JSON.stringify({
      refused: error.message.startsWith('apiRequestContext.delete: connect ECONNREFUSED'),
      denied: error.message.startsWith('apiRequestContext.delete: connect EPERM'),
      containsToken: error.message.includes(process.env.CLRN_5XX_TEST_SECRET),
      containsCallLog: error.message.includes('Call log:'),
    }));
    throw error;
  }) };
  await deleteTable(transport, process.env.CLRN_5XX_TEST_SECRET, ${JSON.stringify(roomId)});
});
test('whitespace prompt must fail', () => expectReadableError('   '));
test('unhandled pageerror must fail', async () => {
  const page = new EventEmitter();
  await withNoPageErrors(page, async () => {
    expectReadableError('Request failed with status code 503');
    page.emit('pageerror', new Error(process.env.CLRN_5XX_TEST_SECRET));
  });
});
`);
    const configuration = path.join(directory, 'playwright.config.mjs');
    await writeFile(configuration, `export default ${JSON.stringify({
      testDir: directory, testMatch: 'cleanup.spec.ts', workers: 1, retries: 0, timeout: 20_000,
      outputDir: path.join(directory, 'browser'),
      reporter: [['list'], ['json', { outputFile: report }]],
      use: { trace: 'off', screenshot: 'off', video: 'off' },
    })};`);
    const result = spawnSync(process.execPath, [path.join(e2e, 'node_modules/playwright/cli.js'),
      'test', '--config', configuration], {
      cwd: e2e, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, CLRN_5XX_TEST_SECRET: `Bearer ${secret}` },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, '清理失败不能被报告为成功');
    const observed = JSON.parse(await readFile(boundary, 'utf8'));
    assert.ok(observed.refused || observed.denied, '必须到达真实请求边界');
    assert.equal(observed.containsToken, true, '原始异常确实携带合成认证头');
    assert.equal(observed.containsCallLog, true);
    if (observed.denied) context.diagnostic('回环请求被沙箱 EPERM 拒绝；仅验证异常脱敏，不代表连接拒绝或 Web 业务验证通过。');
    const contents = await readFile(report, 'utf8');
    const combined = `${result.stdout}\n${result.stderr}\n${contents}`;
    assert.ok(!combined.includes(secret), '终端与 JSON reporter 不得包含认证令牌');
    assert.doesNotMatch(combined, /Call log:/);
    assert.match(combined, new RegExp(`operation=room-delete .*reason=${observed.refused ? 'connection-failed' : 'request-failed'}`));
    const { stats, suites } = JSON.parse(contents);
    assert.equal(stats.unexpected, 3);
    assert.equal(stats.expected, 0);
    assert.equal(stats.skipped, 0);
    assert.equal(stats.flaky, 0);
    assert.match(suites[0].specs[1].tests[0].results[0].error.message, /5xx 应显示非空、可读的错误/);
    assert.match(suites[0].specs[2].tests[0].results[0].error.message, /不得出现未处理页面异常/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
