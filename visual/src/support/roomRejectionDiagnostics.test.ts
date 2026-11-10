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
