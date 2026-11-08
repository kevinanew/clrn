/** 隔离验证公开哨兵脱敏、分块输出和容量清单，不连接任何应用服务。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiagnosticLog, DiagnosticOutput, logText, logError } from './diagnostic-log';
import { DiagnosticRecorder } from './diagnostic-recorder';

test('自由文本隐藏凭据、嵌套正文和私有入口，同时保留普通输出及错误类型/代码', /** 验证公开哨兵脱敏，不使用任何真实连接资料。
 * @param context - 测试环境替换接口。
 */ context => {
  const previous = process.env.DIAGNOSTIC_TEST_PASSWORD;
  process.env.DIAGNOSTIC_TEST_PASSWORD = 'public-password-sentinel';
  context.after(/** 恢复环境变量，不污染其他验证。 */ () => {
    if (previous === undefined) delete process.env.DIAGNOSTIC_TEST_PASSWORD;
    else process.env.DIAGNOSTIC_TEST_PASSWORD = previous;
  });
  const values = [
    'password="public-password-sentinel with spaces"',
    'Authorization: Bearer public-auth-sentinel',
    'Cookie: session=public-cookie-sentinel; auth=public-cookie-tail',
    'payload={\n "nested": "public-body-sentinel"\n}',
    'https://private.fixture.invalid:9443/private?token=public-token-sentinel',
    '192.0.2.10:8443 [2001:db8::10]:9443',
    'standalone public-password-sentinel',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbCJ9.cHVibGlj',
  ];
  const output = values.map(logText).join('\n');
  for (const secret of ['public-password', 'public-auth', 'public-cookie', 'public-body', 'public-token',
    'fixture.invalid', '192.0.2.10', '2001:db8', ':8443', ':9443', 'eyJhbGci']) assert.ok(!output.includes(secret), secret);
  assert.equal(logText('before failure: button handled'), 'before failure: button handled');
  assert.equal(logText('Click locator(\'[data-testid="action"]\')'), 'Click locator(\'[data-testid="action"]\')');
  const error = logError(new TypeError('net::ERR_CONNECTION_RESET https://private.fixture.invalid'));
  assert.equal(error.errorName, 'TypeError');
  assert.equal(error.code, 'net::ERR_CONNECTION_RESET');
  assert.ok(!Object.hasOwn(error, 'status'), '异常文本不能推断 HTTP 状态');
});

test('事件持续落盘，保留最早现场并准确记录容量与文本截断', /** 检查清单和文件在收尾之前已经可读。
 * @param context - 当前测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-log-capacity-'));
  context.after(/** 删除本轮临时诊断。 */ () => rmSync(directory, { force: true, recursive: true }));
  const log = new DiagnosticLog(directory, 'browser', 2400);
  log.record('test.before', { text: 'early-operation' });
  assert.ok(readFileSync(path.join(directory, 'browser.jsonl'), 'utf8').includes('early-operation'));
  log.record('test.large', { text: 'x'.repeat(3000) });
  for (let index = 0; index < 10; index++) log.record('test.after', { text: 'y'.repeat(1000) });
  const manifest = JSON.parse(readFileSync(path.join(directory, 'browser-manifest.json'), 'utf8'));
  const saved = readFileSync(path.join(directory, 'browser.jsonl'), 'utf8');
  assert.equal(manifest.bytes, Buffer.byteLength(saved));
  assert.ok(manifest.bytes <= manifest.limit);
  assert.equal(manifest.events + manifest.dropped, 13);
  assert.equal(manifest.truncatedCharacters, 1000);
  assert.ok(manifest.droppedBytes > 0);
  assert.ok(saved.includes('early-operation'));
});

test('跨输出块的认证行不会泄露，超长行明确丢弃，退出时保留完整尾行', /** 验证真实 stdout 分块边界不绕过脱敏。
 * @param context - 当前测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-log-chunks-'));
  context.after(/** 删除输出分块测试目录。 */ () => rmSync(directory, { force: true, recursive: true }));
  const log = new DiagnosticLog(directory, 'runner');
  const output = new DiagnosticOutput(log, 'test.stdout');
  output.write('before failure\nAuthorization: Bea');
  output.write('rer public-chunk-sentinel\n');
  output.write('payload={\n "fakeEnd":"}",\n "nested":"public-chunk-body-sentinel"\n}\n');
  output.write('a'.repeat(65537));
  output.write('public-long-sentinel\n');
  output.write('last line');
  output.flush();
  const saved = readFileSync(path.join(directory, 'runner.jsonl'), 'utf8');
  assert.ok(saved.includes('before failure'));
  assert.ok(saved.includes('last line'));
  assert.ok(saved.includes('collection.output-line-dropped'));
  assert.ok(!saved.includes('public-chunk-sentinel'));
  assert.ok(!saved.includes('public-long-sentinel'));
  assert.ok(!saved.includes('public-chunk-body-sentinel'));
});

test('复用采集器在内存轮转之前持续保留早期事件', /** 验证已有采集器的快照语义与新增持久化副本兼容。
 * @param context - 当前测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-recorder-stream-'));
  context.after(/** 删除采集器持久化测试目录。 */ () => rmSync(directory, { force: true, recursive: true }));
  const log = new DiagnosticLog(directory, 'browser');
  const recorder = new DiagnosticRecorder(/** 将既有白名单事件持续落盘。
   * @param event - 脱敏事件。
   */ event => log.record(event.event, event));
  for (let count = 0; count < 5001; count++) recorder.record('test.step', { count, token: 'public-stream-sentinel' });
  assert.equal(recorder.snapshot().dropped, 1);
  assert.equal(recorder.snapshot().events[0].count, 1);
  const saved = readFileSync(path.join(directory, 'browser.jsonl'), 'utf8');
  assert.ok(saved.includes('"count":0'));
  assert.ok(saved.includes('"count":5000'));
  assert.ok(!saved.includes('public-stream-sentinel'));
});

for (const container of ['object', 'array']) for (const chunkSize of [1, 65536, 100000]) {
  test(`${container} 超长起始行按 ${chunkSize} 字符分块后仍隐藏全部正文并准确计数`, /** 检查容量丢弃不能重置正文的结构、引号和转义状态。
   * @param context - 测试清理接口。
   */ context => {
    const directory = mkdtempSync(path.join(tmpdir(), 'clrn-log-structure-'));
    context.after(/** 删除结构化输出测试文件。 */ () => rmSync(directory, { force: true, recursive: true }));
    const output = new DiagnosticOutput(new DiagnosticLog(directory, 'runner'), 'test.stdout');
    const padding = JSON.stringify('x'.repeat(65537) + '\\"}] public-padding-tail');
    const first = container === 'object' ? `{"padding":${padding},` : `[${padding},`;
    const body = container === 'object' ? '"session_key":"public-long-json-credential"' : '"public-long-array-credential"';
    const json = `${first}\n${body}\n${container === 'object' ? '}' : ']'}`;
    assert.doesNotThrow(/** 哨兵来自合法 JSON，不能依赖畸形日志触发。 */ () => JSON.parse(json));
    const text = `before failure\n${json}\nafter cleanup`;
    for (let offset = 0; offset < text.length; offset += chunkSize) output.write(text.slice(offset, offset + chunkSize));
    output.flush();
    const saved = readFileSync(path.join(directory, 'runner.jsonl'), 'utf8');
    assert.ok(!saved.includes('public-'), '超长正文及其续行不能泄露哨兵');
    const events = saved.trim().split('\n').map(/** 读取最终持久化事件，验证实际文本和丢弃统计。
     * @param line - 单条 JSONL。
     */ line => JSON.parse(line));
    assert.deepEqual(events.filter(/** 只取容量丢弃记录。
     * @param event - 持久化事件。
     */ event => event.event === 'collection.output-line-dropped').map(/** 返回实际丢弃字符数。
     * @param event - 丢弃事件。
     */ event => event.droppedCharacters), [first.length]);
    assert.ok(events.some(/** 保留失败前的普通日志。
     * @param event - 持久化事件。
     */ event => event.text === 'before failure'));
    assert.ok(events.some(/** 完整结构结束后恢复清理日志。
     * @param event - 持久化事件。
     */ event => event.text === 'after cleanup'));
  });
}

test('数组起始符和正文跨行、跨块时继续隐藏，字符串内括号及转义不能提前关闭结构', /** 覆盖没有同行元素的标准 JSON 数组和逐字符输入。
 * @param context - 测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-log-array-'));
  context.after(/** 删除数组测试文件。 */ () => rmSync(directory, { force: true, recursive: true }));
  const output = new DiagnosticOutput(new DiagnosticLog(directory, 'runner'), 'test.stderr');
  const body = '[\n' + JSON.stringify('\\"}] public-array-quoted') + ',\n"public-array-tail"\n]\ncleanup';
  for (const character of body) output.write(character);
  output.flush();
  const saved = readFileSync(path.join(directory, 'runner.jsonl'), 'utf8');
  assert.ok(!saved.includes('public-array-'));
  assert.ok(saved.includes('cleanup'));
});

test('失败输入的调用日志不携带输入值，错误原因及网络代码仍可读取', /** Playwright dom.fill/type 的 progress 日志直接包含原始输入值。 */ () => {
  const error = logError(new Error('locator.fill: Element is not an <input>\nCall log:\n - fill("public-failed-prefix"public-failed-tail")'));
  assert.ok(!error.text.includes('public-'));
  assert.ok(error.text.includes('Element is not an <input>'));
  const network = logError(new Error('apiRequestContext.get: ECONNRESET\nCall log:\n - Authorization: Bearer public-error-token'));
  assert.equal(network.code, 'ECONNRESET');
  assert.ok(!network.text.includes('public-'));
});

test('UTF-8 字符跨 Buffer 边界不破坏完整环境 Secret 的脱敏', /** 子进程 stdout/stderr 使用 Buffer，非 ASCII 密码也是有效 CI 凭据。
 * @param context - 测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-log-utf8-'));
  const previous = process.env.DIAGNOSTIC_TEST_PASSWORD;
  process.env.DIAGNOSTIC_TEST_PASSWORD = 'public-前byte-tail';
  context.after(/** 恢复环境并清理字节分块日志。 */ () => {
    if (previous === undefined) delete process.env.DIAGNOSTIC_TEST_PASSWORD;
    else process.env.DIAGNOSTIC_TEST_PASSWORD = previous;
    rmSync(directory, { force: true, recursive: true });
  });
  const output = new DiagnosticOutput(new DiagnosticLog(directory, 'proxy'), 'proxy.stdout');
  const bytes = Buffer.from(`${process.env.DIAGNOSTIC_TEST_PASSWORD}\ncleanup`);
  for (let index = 0; index < bytes.length; index++) output.write(bytes.subarray(index, index + 1));
  output.flush();
  const saved = readFileSync(path.join(directory, 'proxy.jsonl'), 'utf8');
  assert.ok(!saved.includes('public-'));
  assert.ok(saved.includes('cleanup'));
});
