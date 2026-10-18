/** 验证所有 CI 账号设备标识互异，并限制视觉测试只能补充 Web 账号余额。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisualDeviceId, canTopUpVisualAccount } from './test-account';
import accounts from '../scripts/ci-test-accounts.json';

test('170 个 CI 账号使用不同设备，同一账号重跑和大小写变化保持一致', () => {
  const devices = accounts.accounts.map(username => getVisualDeviceId({ VISUAL_USERNAME: username }));
  assert.equal(new Set(devices).size, 170);
  for (const [index, username] of accounts.accounts.entries()) {
    assert.match(devices[index], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(getVisualDeviceId({ VISUAL_USERNAME: username.toUpperCase() }), devices[index]);
  }
  assert.equal(getVisualDeviceId({ VISUAL_DEVICE_ID: 'explicit-device' }), 'explicit-device');
  assert.equal(new Set(['app', 'texas', 'zhajinhua'].map(suite => getVisualDeviceId({ VISUAL_SUITE: suite }))).size, 3);
});

test('100 个 Web 账号允许在 CI 中准备余额，安卓账号不能借用', () => {
  assert.equal(accounts.webAccounts.length, 100);
  for (const username of accounts.webAccounts) {
    assert.equal(canTopUpVisualAccount(username, { VISUAL_USERNAME: username, GITHUB_ACTIONS: 'true' }), true);
    assert.equal(canTopUpVisualAccount(username, { VISUAL_USERNAME: 'another-account', GITHUB_ACTIONS: 'true' }), false);
  }
  for (const username of accounts.accounts.filter(name => !accounts.webAccounts.includes(name))) {
    assert.equal(canTopUpVisualAccount(username, { VISUAL_USERNAME: username, GITHUB_ACTIONS: 'true' }), false);
  }
});
