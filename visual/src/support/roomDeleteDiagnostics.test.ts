/** 验证 Undici 事件关联、隐私边界及诊断失败隔离。 */
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import test from 'node:test';
import { diagnoseRoomDelete } from './roomDeleteDiagnostics';

test('只记录目标删除请求阶段，诊断输出失败仍保留原始异常', /** 验证请求关联和异常身份。
 * @param context - 测试隔离的 mock 上下文。 */ async context => {
  const url = 'https://private.invalid/private-room?secret=hidden';
  const request = { method: 'DELETE', origin: 'https://private.invalid', path: '/private-room?secret=hidden' };
  const logs: string[] = [];
  const original = new Error('private failure');
  context.mock.method(console, 'error', /** 收集固定格式的脱敏输出。
 * @param line - 诊断摘要。 */ (line: string) => logs.push(line));
  await assert.rejects(diagnoseRoomDelete(url, /** 模拟 Undici 生命周期及无响应失败。 */ async () => {
    channel('undici:request:create').publish({ request });
    channel('undici:request:bodySent').publish({ request });
    channel('undici:request:headers').publish({ request: { ...request, path: '/unrelated' } });
    throw original;
  }), /** 核对原始异常未被替换。
 * @param error - 实际抛出的异常。 */ error => error === original);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^ROOM DELETE DIAGNOSTIC > phase=sent-awaiting-response elapsedMs=\d+$/);
  context.mock.method(console, 'error', /** 模拟日志系统异常。 */ () => { throw new Error('diagnostic failure'); });
  await assert.rejects(diagnoseRoomDelete(url, /** 模拟原始请求失败。 */ async () => { throw original; }),
    /** 核对日志异常未覆盖请求异常。
 * @param error - 实际抛出的异常。 */ error => error === original);
});
