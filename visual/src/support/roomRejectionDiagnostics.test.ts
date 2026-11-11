import assert from 'node:assert/strict';
import { test as playwrightTest } from '@playwright/test';
import test from 'node:test';
import { readRequestJson } from './requestJson';

for (const [operation, status] of [['room-delete', 500], ['leaderboard-statistics', 503]] as const) {
test(`${operation} HTTP ${status} 记录有限分类，正文或附件失败不覆盖 HTTP 错误`, /** 验证 HTTP 错误诊断及其失败优先级。
 * @param context - 当前测试的模拟范围。 */ async context => {
  const attachments: string[] = [];
  let failAttachment = false;
  context.mock.method(playwrightTest, 'info', /** 提供隔离的附件接收器。 */ () => ({
    /** 收集报告正文或模拟附件写入失败。
     * @param name - 附件名称。
     * @param options - 已脱敏的报告正文。 */
    async attach(name: string, options: { body: string }) {
      assert.equal(name, `${operation}-rejection`);
      if (failAttachment) throw new Error('synthetic attachment failure');
      attachments.push(options.body);
    },
  }));
  const response = {
    /** 返回模拟的服务器错误状态。 */ status: () => status,
    /** 标记 HTTP 响应失败。 */ ok: () => false,
    /** 返回包含合成敏感信息的错误正文。 */ json: async () => ({ error_type: 'server_error', code: 42, errors: 'synthetic-secret' }),
  };
  const originalError = new RegExp(`status=${status} .*reason=http-error`);
  await assert.rejects(readRequestJson(response, operation), originalError);
  assert.equal(JSON.parse(attachments[0]).category, 'server_error');
  assert.doesNotMatch(attachments[0], /synthetic-secret/);
  await assert.rejects(readRequestJson({ ...response,
    /** 未知类型中的自由文本仅保留哈希。 */ json: async () => ({ error_type: 'private-token@example.invalid', errors: 'synthetic-secret' }),
  }, operation), originalError);
  const unknown = JSON.parse(attachments[1]);
  assert.equal(unknown.category, 'unclassified');
  assert.match(unknown.typeFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(attachments[1], /private-token|example|synthetic-secret/);
  failAttachment = true;
  await assert.rejects(readRequestJson(response, operation), originalError);
  for (const error of [new SyntaxError('synthetic non-JSON body'), new Error('synthetic read failure')]) {
    await assert.rejects(readRequestJson({ ...response, json: /** 模拟正文解析或读取失败。 */ async () => { throw error; } }, operation), originalError);
  }
});
}
