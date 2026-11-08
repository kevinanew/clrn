import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readLoginCache } from './auth';

/**
 * 按 Playwright 的函数序列化方式读取浏览器缓存，确保不依赖 Node 闭包。
 * @param raw - 浏览器存储中的原始字符串。
 */
function readSerializedCache(raw: string | null) {
  return runInNewContext(`(${readLoginCache.toString()})()`, {
    localStorage: { getItem: /** 返回此场景的本地缓存。 */ () => raw },
  });
}

for (const cache of [null, {}, { user_id: 'u' }, { api_token: {} },
  { user_id: 'u', api_token: { access_token: 't' } },
  { user_id: 'u', api_token: { token_type: 'Bearer' } },
  { user_id: '', api_token: { access_token: 't', token_type: 'Bearer' } }]) {
  test(`缺失认证字段必须拒绝：${JSON.stringify(cache)}`, /** 保留完整缓存要求，不能接受部分登录态。 */ () => {
    assert.throws(/** 在浏览器沙箱中读取不完整缓存。 */ () => readSerializedCache(JSON.stringify(cache)), /登录后未生成完整认证缓存/);
  });
}

test('完整认证缓存可序列化读取，保留用户 ID 和令牌格式', /** 验证浏览器内执行成功且不依赖外部辅助函数。 */ () => {
  const result = readSerializedCache(JSON.stringify({ user_id: 42, api_token: { access_token: 'token', token_type: 'Bearer' } }));
  assert.equal(result.userId, '42');
  assert.equal(result.authorization, 'Bearer token');
  assert.throws(/** 缺失浏览器存储仍拒绝登录。 */ () => readSerializedCache(null), /登录后未生成完整认证缓存/);
  assert.throws(/** 解析错误必须继续失败。 */ () => readSerializedCache('{'), /SyntaxError/);
});
