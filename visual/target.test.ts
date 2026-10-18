/** 验证线上入口限制和 Release 模式强制使用本轮回环服务器。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readVisualUrl } from './target';

test('默认使用指定线上 staging，允许旧 staging 域名', () => {
  assert.equal(readVisualUrl({}), 'https://h5.page.shafayouxi.org/');
  assert.equal(readVisualUrl({ VISUAL_BASE_URL: 'https://h5.shafayouxi.org' }), 'https://h5.shafayouxi.org/');
});

test('本地环境、生产域名及伪装域名不能作为登录测试目标', () => {
  for (const address of [
    'http://127.0.0.1:8080',
    'https://localhost',
    'https://h5.laiwan.life/',
    'https://h5.page.shafayouxi.org.example.com/',
    'http://h5.page.shafayouxi.org/',
  ]) {
    assert.throws(() => readVisualUrl({ VISUAL_BASE_URL: address }), /staging HTTPS/);
  }
});

test('Release 模式优先使用本轮服务器并拒绝未启动或伪装的地址', () => {
  const environment = { CLRN_RELEASE_WEB_ROOT: '/temporary/site',
    CLRN_EXPECTED_APPLICATION_COMMIT: 'a'.repeat(40), CLRN_RELEASE_WEB_URL: 'http://127.0.0.1:43210/' };
  assert.equal(readVisualUrl({ ...environment, VISUAL_BASE_URL: 'https://h5.page.shafayouxi.org/' }), environment.CLRN_RELEASE_WEB_URL);
  assert.throws(() => readVisualUrl({ ...environment, CLRN_RELEASE_WEB_URL: '' }), /必须通过/);
  for (const address of ['http://127.0.0.1.evil.test:43210/', 'https://h5.laiwan.life/',
    'http://127.0.0.1/', 'http://user:password@127.0.0.1:43210/', 'http://127.0.0.1:43210/?redirect=evil']) {
    assert.throws(() => readVisualUrl({ ...environment, CLRN_RELEASE_WEB_URL: address }));
  }
});
