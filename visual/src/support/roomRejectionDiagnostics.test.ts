import assert from 'node:assert/strict';
import { test as playwrightTest } from '@playwright/test';
import test from 'node:test';
import { readRequestJson } from './requestJson';

for (const operation of ['room-delete', 'room-create', 'leaderboard-statistics'] as const) {
const status = operation === 'leaderboard-statistics' ? 503 : 500;
test(`${operation} HTTP ${status} 记录有限分类，正文或附件失败不覆盖 HTTP 错误`, /** 验证 HTTP 错误诊断及其失败优先级。
 * @param context - 当前测试的模拟范围。 */ async context => {
  const attachments: string[] = [];
  let failAttachment = false;
  const warnings: string[] = [];
  context.mock.method(console, 'warn', /** 收集附件不可用时的脱敏诊断。
   * @param message - 固定操作与有限响应分类。 */ (message: string) => warnings.push(message));
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
  assert.match(warnings.at(-1)!, /server_error/);
  assert.doesNotMatch(warnings.at(-1)!, /synthetic/);
  failAttachment = false;
  for (const error of [new SyntaxError('synthetic non-JSON body'), new Error('synthetic read failure')]) {
    await assert.rejects(readRequestJson({ ...response, json: /** 模拟正文解析或读取失败。 */ async () => { throw error; } }, operation), originalError);
    const diagnostic = JSON.parse(attachments.at(-1)!);
    assert.equal(diagnostic.bodyRead, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed');
    assert.doesNotMatch(attachments.at(-1)!, /synthetic/);
    failAttachment = true;
    await assert.rejects(readRequestJson({ ...response, json: /** 同时模拟正文与附件失败。 */ async () => { throw error; } }, operation), originalError);
    failAttachment = false;
  }
});
}

test('建房业务拒绝复用有限分类并保留原始错误', /** 验证 HTTP 成功不掩盖业务拒绝。
 * @param context - 当前测试的模拟范围。 */ async context => {
  let attachment = '';
  context.mock.method(playwrightTest, 'info', /** 提供隔离附件接收器。 */ () => ({
    /** 记录业务拒绝的安全报告。
     * @param name - 固定附件名称。
     * @param options - 已脱敏的正文。 */
    async attach(name: string, options: { body: string }) {
      assert.equal(name, 'room-create-rejection');
      attachment = options.body;
    },
  }));
  await assert.rejects(readRequestJson({ status: /** 真实 HTTP 成功。 */ () => 200,
    ok: /** 真实 HTTP 成功。 */ () => true,
    json: /** 合成业务拒绝与不可输出正文。 */ async () => ({ ok: false, error_type: 'room_limit_exceeded', errors: 'synthetic-secret' }),
  }, 'room-create'), /status=200 .*reason=business-rejected/);
  assert.equal(JSON.parse(attachment).category, 'room_limit_exceeded');
  assert.doesNotMatch(attachment, /synthetic-secret/);
});
