/** 离线验证 CORS 状态取证、隐私边界及诊断失败隔离。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Page, TestInfo } from '@playwright/test';
import { collectGameRecordDiagnostics } from './diagnostics';
import { diagnosticCaseDirectory } from '../../helpers/diagnostic-log';

test('CORS 拒绝仍保留真实状态，不输出地址、身份、头部或正文', /** 验证被 Playwright 隐藏的响应可定位且保持脱敏。
 * @param context - 提供测试结束后自动恢复的时钟替身。
 */ async context => {
  // 时间戳包含 403 时也不能被误判为未登记请求的 HTTP 状态。
  context.mock.method(Date, 'now', /** 固定为包含干扰数字的毫秒时间戳。 */ () => Date.UTC(2026, 10, 10, 21, 46, 43, 403));
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-record-cors-'));
  const previous = process.env.CLRN_DIAGNOSTIC_SESSION;
  process.env.CLRN_DIAGNOSTIC_SESSION = directory;
  const session = Object.assign(new EventEmitter(), {
    /** 本测试只允许启用观察，不允许修改浏览器网络行为。
     * @param method - CDP 命令名。
     */
    async send(method: string) { assert.equal(method, 'Network.enable'); },
    /** 模拟诊断清理失败，验证不产生未处理拒绝。 */
    async detach() { throw new Error('secret'); },
  });
  const page = Object.assign(new EventEmitter(), {
    /** 提供仅有观察功能的会话。 */
    context() { return { newCDPSession: /** 返回离线诊断会话。 */ async () => session }; },
  });
  const info = { testId: 'record', retry: 1, workerIndex: 2 } as TestInfo;
  try {
    await collectGameRecordDiagnostics(page as unknown as Page, info);
    session.emit('Network.requestWillBeSent', { requestId: '1', request: {
      url: 'https://private.invalid/v1/texas_statistics/player/private-user/rounds/private-round?token=secret',
      method: 'PUT', headers: { Authorization: 'secret' }, postData: 'secret',
    } });
    session.emit('Network.responseReceivedExtraInfo', {
      requestId: '1', statusCode: 503, headers: { 'Set-Cookie': 'secret' },
    });
    session.emit('Network.loadingFailed', {
      requestId: '1', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' }, errorText: 'secret',
    });
    session.emit('Network.requestWillBeSent', { requestId: '2', request: {
      url: 'https://private.invalid/private-entry?token=secret', method: 'PUT',
    } });
    session.emit('Network.responseReceivedExtraInfo', { requestId: '2', statusCode: 403 });
    const legacyPaths = ['/v10/texas_holdem/user/private-user/game_records',
      '/v1/game_log/user/private-user/rooms/settlement', '/v1/game_log/room/settlement'];
    legacyPaths.forEach(/** 验证旧版列表及后续批次接口都能保留 CORS 前的状态。
     * @param endpoint - 不含真实身份的测试接口。
     * @param index - 独立请求编号。
     */ (endpoint, index) => {
      const requestId = `legacy-${index}`;
      session.emit('Network.requestWillBeSent', { requestId, request: {
        url: `https://private.invalid${endpoint}?token=secret`, method: index ? 'PUT' : 'GET',
      } });
      session.emit('Network.responseReceivedExtraInfo', { requestId, statusCode: 502 });
      session.emit('Network.loadingFailed', { requestId, corsErrorStatus: {} });
    });
    page.emit('close');
    const output = readFileSync(path.join(diagnosticCaseDirectory(info), 'game-record-network.jsonl'), 'utf8');
    assert.match(output, /"status":503/);
    assert.match(output, /"reason":"cors"/);
    assert.match(output, /\/v1\/texas_statistics\/player\/\{user\}\/rounds\/\{rounds\}/);
    const events = output.trim().split('\n').map(/** 读取单条结构化诊断事件。
     * @param line - 一行 JSON。
     */ line => JSON.parse(line));
    const statuses = events.filter(/** 只选择实际 HTTP 状态字段。
     * @param event - 已解析事件。
     */ event => 'status' in event).map(/** 提取状态，排除时间戳等元数据。
     * @param event - 含状态的事件。
     */ event => event.status);
    assert.deepEqual(statuses, [503, 502, 502, 502]);
    assert.equal(events.filter(/** 仅统计已关联的真实请求。
     * @param event - 已解析事件。
     */ event => event.event === 'http.start').length, 4);
    for (const secret of ['private.invalid', 'private-user', 'private-round', 'secret', 'private-entry']) {
      assert.ok(!output.includes(secret), secret);
    }
    const unavailable = { /** 模拟可选诊断安装失败。 */ context() { throw new Error('secret'); } } as unknown as Page;
    await assert.doesNotReject(collectGameRecordDiagnostics(unavailable, info));
  } finally {
    if (previous === undefined) delete process.env.CLRN_DIAGNOSTIC_SESSION;
    else process.env.CLRN_DIAGNOSTIC_SESSION = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
