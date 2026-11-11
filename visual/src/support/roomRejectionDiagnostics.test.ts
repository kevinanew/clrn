import assert from 'node:assert/strict';
import { test as playwrightTest } from '@playwright/test';
import test from 'node:test';
import { readRequestJson } from './requestJson';

for (const [operation, status, reason] of [
  ['room-delete', 500, 'http-error'], ['room-create', 200, 'business-rejected'],
  ['room-create', 500, 'http-error'],
] as const) {
  test(`${operation} HTTP ${status} 记录有限分类，正文或附件失败不覆盖原始错误`, /** 验证拒绝诊断及其失败优先级。
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
      /** 返回模拟响应的真实状态。 */ status: () => status,
      /** 按实际状态判断 HTTP 是否成功。 */ ok: () => status === 200,
      /** 返回包含合成敏感信息的错误正文。 */ json: async () => ({ error_type: 'server_error', code: 42, errors: 'synthetic-secret' }),
    };
    const originalError = new RegExp(`status=${status} .*reason=${reason}`);
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
      const expected = status === 500 ? originalError
        : new RegExp(`status=200 .*reason=${error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed'}`);
      await assert.rejects(readRequestJson({ ...response, json: /** 模拟正文解析或读取失败。 */ async () => { throw error; } }, operation), expected);
    }
  });
}

for (const operation of ['room-create', 'room-delete'] as const) {
test(`${operation} 非 JSON HTTP 错误只保留正文指纹与格式，读取失败仍保留原始 HTTP 错误`, /** 验证真实错误页的脱敏取证。
 * @param context - 当前测试的模拟范围。 */ async context => {
  const attachments: string[] = [];
  context.mock.method(playwrightTest, 'info', /** 提供隔离的附件接收器。 */ () => ({
    /** 收集脱敏诊断。
     * @param name - 固定附件名称。
     * @param options - 不含原始正文的附件。 */
    async attach(name: string, options: { body: string }) { attachments.push(options.body); },
  }));
  const response = { status: /** 返回上游失败。 */ () => 500, ok: /** 保留 HTTP 失败。 */ () => false,
    json: /** 不应重复读取正文。 */ async () => { throw new Error('unexpected second read'); },
    text: /** 模拟含私密内容的 HTML 错误页。 */ async () => '<html>synthetic-secret</html>' };
  await assert.rejects(readRequestJson(response, operation), /status=500 .*reason=http-error/);
  const diagnostic = JSON.parse(attachments[0]);
  assert.equal(diagnostic.bodyRead, 'invalid-json');
  assert.equal(diagnostic.wireBody.format, 'html');
  assert.equal(diagnostic.wireBody.bytes, 29);
  assert.match(diagnostic.wireBody.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(attachments[0], /synthetic-secret|<html>/);
  await assert.rejects(readRequestJson({ ...response,
    text: /** 模拟正文读取失败。 */ async () => { throw new Error('synthetic-secret'); },
  }, operation), /status=500 .*reason=http-error/);
  assert.equal(JSON.parse(attachments[1]).bodyRead, 'body-read-failed');
  assert.doesNotMatch(attachments[1], /synthetic-secret/);
});
}
