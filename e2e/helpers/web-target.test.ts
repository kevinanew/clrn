/** 验证普通 staging 和固定 Release 的入口隔离与拒绝边界。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readTestWebUrl } from './web-target';

const commit = 'a'.repeat(40);
const release = { CLRN_RELEASE_WEB_URL: 'http://127.0.0.1:12345/', CLRN_RELEASE_WEB_ROOT: '/verified/release',
  CLRN_EXPECTED_APPLICATION_COMMIT: commit };

for (const address of [undefined, '', 'https://h5.page.shafayouxi.org/', 'https://h5.shafayouxi.org/']) {
  test(`普通入口保留允许的 staging：${address}`, /** 默认或明确的 staging 均按 URL 规范化。 */ () => {
    assert.equal(readTestWebUrl(address, {}), address || 'https://h5.page.shafayouxi.org/');
  });
}

test('Release 覆盖普通配置且缺少启动地址时拒绝回退 staging', /** 保留同轮服务器绑定。 */ () => {
  assert.equal(readTestWebUrl('https://h5.shafayouxi.org/', release), release.CLRN_RELEASE_WEB_URL);
  assert.throws(/** 缺少本轮服务器地址时禁止继续。 */ () => readTestWebUrl(undefined, { CLRN_RELEASE_WEB_ROOT: '/verified/release' }),
    /必须通过 with-release-web-server/);
});

for (const address of ['https://user@h5.page.shafayouxi.org/', 'https://:password@h5.page.shafayouxi.org/',
  'https://h5.page.shafayouxi.org/path', 'https://h5.page.shafayouxi.org/?secret=1', 'https://h5.page.shafayouxi.org/#fragment']) {
  test(`拒绝入口额外字段：${address}`, /** 防止认证、路径和查询参数进入测试入口。 */ () => {
    assert.throws(/** 校验普通入口拒绝边界。 */ () => readTestWebUrl(address, {}), /只能包含协议、主机和端口/);
  });
}

for (const address of ['http://h5.page.shafayouxi.org/', 'https://h5.laiwan.life/', 'http://127.0.0.1:12345/',
  'https://h5.page.shafayouxi.org.evil.invalid/']) {
  test(`普通模式拒绝非 staging：${address}`, /** 不允许回环或伪造后缀绕过模式校验。 */ () => {
    assert.throws(/** 校验普通模式的站点限制。 */ () => readTestWebUrl(address, {}), /测试地址必须是 staging HTTPS/);
  });
}

for (const override of [
  { CLRN_RELEASE_WEB_ROOT: '' }, { CLRN_EXPECTED_APPLICATION_COMMIT: undefined },
  { CLRN_EXPECTED_APPLICATION_COMMIT: 'abc1234' }, { CLRN_EXPECTED_APPLICATION_COMMIT: 'A'.repeat(40) },
  { CLRN_RELEASE_WEB_URL: 'https://127.0.0.1:12345/' }, { CLRN_RELEASE_WEB_URL: 'http://localhost:12345/' },
  { CLRN_RELEASE_WEB_URL: 'http://127.0.0.1/' },
]) {
  test(`Release 拒绝未绑定的配置：${JSON.stringify(override)}`, /** 固定提交、目录及本轮回环端口必须同时存在。 */ () => {
    assert.throws(/** 校验 Release 的逐项拒绝边界。 */ () => readTestWebUrl(undefined, { ...release, ...override }), /本轮校验过的回环服务器/);
  });
}
