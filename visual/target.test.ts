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
