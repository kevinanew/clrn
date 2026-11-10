import assert from 'node:assert/strict';
import { test as playwrightTest } from '@playwright/test';
import test from 'node:test';
import { readRequestJson } from './requestJson';

test('建房拒绝诊断隐藏自由文本，附件失败仍传播原始业务拒绝', /** 用合成凭据验证报告边界和失败优先级。
 * @param context - 当前测试的模拟范围。 */ async context => {
  const attachments: string[] = [];
  let failAttachment = false;
  context.mock.method(playwrightTest, 'info', /** 提供隔离的附件接收器。 */ () => ({
    /**
     * 收集实际报告内容或模拟报告写入失败。
     * @param name - 固定附件名。
     * @param options - 已脱敏的报告正文。
     */
    async attach(name: string, options: { body: string }) {
      assert.equal(name, 'room-create-rejection');
      if (failAttachment) throw new Error('synthetic attachment failure');
      attachments.push(options.body);
    },
  }));
  const response = {
    /** 保留真实成功 HTTP 状态。 */ status: () => 200,
    /** 业务失败不改变 HTTP 成功结果。 */ ok: () => true,
    /** 响应携带不得输出的合成资料。 */ json: async () => ({ ok: false,
      error_type: 'private-token@example.invalid', code: 42, errors: { password: 'synthetic-secret' } }),
  };
  await assert.rejects(readRequestJson(response, 'room-create'), /status=200 .*reason=business-rejected/);
  const diagnostic = JSON.parse(attachments[0]);
  assert.equal(diagnostic.category, 'unclassified');
  assert.equal(diagnostic.code, 42);
  assert.match(diagnostic.typeFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(attachments[0], /private-token|example|synthetic-secret|password/);
  failAttachment = true;
  await assert.rejects(readRequestJson(response, 'room-create'), /status=200 .*reason=business-rejected/);
});

for (const operation of ['room-create', 'room-delete'] as const) {
test(`${operation} HTTP 500 记录有限分类，正文或附件失败不覆盖 HTTP 错误`, /** 验证 HTTP 错误诊断及其失败优先级。
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
    /** 返回模拟的服务器错误状态。 */ status: () => 500,
    /** 标记 HTTP 响应失败。 */ ok: () => false,
    /** 返回包含合成敏感信息的错误正文。 */ json: async () => ({ error_type: 'server_error', code: 42, errors: 'synthetic-secret' }),
  };
  const originalError = /status=500 .*reason=http-error/;
  await assert.rejects(readRequestJson(response, operation), originalError);
  assert.equal(JSON.parse(attachments[0]).category, 'server_error');
  assert.doesNotMatch(attachments[0], /synthetic-secret/);
  failAttachment = true;
  await assert.rejects(readRequestJson(response, operation), originalError);
  for (const error of [new SyntaxError('synthetic non-JSON body'), new Error('synthetic read failure')]) {
    await assert.rejects(readRequestJson({ ...response, json: /** 模拟正文解析或读取失败。 */ async () => { throw error; } }, operation), originalError);
  }
});
}
