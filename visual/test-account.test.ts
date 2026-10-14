import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisualDeviceId } from './test-account';
import accounts from '../scripts/ci-test-accounts.json';

test('30 个 CI 账号使用不同设备，同一账号重跑和大小写变化保持一致', () => {
  const devices = accounts.accounts.map(username => getVisualDeviceId({ VISUAL_USERNAME: username }));
  assert.equal(new Set(devices).size, 30);
  for (const [index, username] of accounts.accounts.entries()) {
    assert.match(devices[index], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(getVisualDeviceId({ VISUAL_USERNAME: username.toUpperCase() }), devices[index]);
  }
  assert.equal(getVisualDeviceId({ VISUAL_DEVICE_ID: 'explicit-device' }), 'explicit-device');
  assert.equal(new Set(['app', 'texas', 'zhajinhua'].map(suite => getVisualDeviceId({ VISUAL_SUITE: suite }))).size, 3);
});
