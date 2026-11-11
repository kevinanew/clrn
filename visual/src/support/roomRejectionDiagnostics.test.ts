import assert from 'node:assert/strict';
import { test as playwrightTest } from '@playwright/test';
import test from 'node:test';
import { readRequestJson } from './requestJson';

for (const operation of ['room-delete', 'room-create'] as const) {
test(`${operation} HTTP 500 记录有限分类，正文或附件失败不覆盖 HTTP 错误`, /** 验证 HTTP 错误诊断及其失败优先级。
 * @param context - 当前测试的模拟范围。 */ async context => {
  const attachments: string[] = [];
  const fallback: string[] = [];
  context.mock.method(console, 'warn', /** 收集附件不可用时的脱敏后备输出。
   * @param message - 已脱敏的诊断。 */ (message: string) => { fallback.push(message); });
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
  await assert.rejects(readRequestJson({ ...response,
    /** 未知类型中的自由文本仅保留哈希。 */ json: async () => ({ error_type: 'private-token@example.invalid', errors: 'synthetic-secret' }),
  }, operation), originalError);
  const unknown = JSON.parse(attachments[1]);
  assert.equal(unknown.category, 'unclassified');
  assert.match(unknown.typeFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(attachments[1], /private-token|example|synthetic-secret/);
  failAttachment = true;
  await assert.rejects(readRequestJson(response, operation), originalError);
  assert.match(fallback[0], new RegExp(`^${operation}-rejection `));
  assert.doesNotMatch(fallback[0], /synthetic-secret/);
  for (const error of [new SyntaxError('synthetic non-JSON body'), new Error('synthetic read failure')]) {
    await assert.rejects(readRequestJson({ ...response, json: /** 模拟正文解析或读取失败。 */ async () => { throw error; } }, operation), originalError);
  }
  assert.match(fallback[1], /"bodyRead":"invalid-json"/);
  assert.match(fallback[2], /"bodyRead":"body-read-failed"/);
  context.mock.method(console, 'warn', /** 后备输出失败也不能取代原始异常。 */ () => { throw new Error('synthetic-secret'); });
  await assert.rejects(readRequestJson(response, operation), originalError);
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

test('非 JSON HTTP 错误只保留正文指纹与格式，读取失败仍保留原始 HTTP 错误', /** 验证真实错误页的脱敏取证。
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
  await assert.rejects(readRequestJson(response, 'room-delete'), /status=500 .*reason=http-error/);
  const diagnostic = JSON.parse(attachments[0]);
  assert.equal(diagnostic.bodyRead, 'invalid-json');
  assert.equal(diagnostic.wireBody.format, 'html');
  assert.equal(diagnostic.wireBody.bytes, 29);
  assert.match(diagnostic.wireBody.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(attachments[0], /synthetic-secret|<html>/);
  await assert.rejects(readRequestJson({ ...response,
    text: /** 模拟标准错误页，私密正文不能输出。 */ async () => '<html><title>500 Internal Server Error</title>synthetic-secret</html>',
    headers: /** 模拟含私密版本及其他头的服务标识。 */ () => ({ server: 'nginx/private-version', authorization: 'synthetic-secret' }),
  }, 'room-create'), /status=500 .*reason=http-error/);
  assert.equal(JSON.parse(attachments.at(-1)!).wireBody.errorPage, 'internal-server-error');
  assert.equal(JSON.parse(attachments.at(-1)!).wireBody.server, 'nginx');
  assert.doesNotMatch(attachments.at(-1)!, /private-version|authorization|synthetic-secret/);
  await assert.rejects(readRequestJson({ ...response,
    headers: /** 诊断读取异常不能改变正文诊断或原始失败。 */ () => { throw new Error('synthetic-secret'); },
  }, 'room-delete'), /status=500 .*reason=http-error/);
  assert.equal(JSON.parse(attachments.at(-1)!).wireBody.server, 'unknown');
  await assert.rejects(readRequestJson({ ...response,
    text: /** 模拟正文读取失败。 */ async () => { throw new Error('synthetic-secret'); },
  }, 'room-create'), /status=500 .*reason=http-error/);
  assert.equal(JSON.parse(attachments.at(-1)!).bodyRead, 'body-read-failed');
  assert.doesNotMatch(attachments.at(-1)!, /synthetic-secret/);
});
