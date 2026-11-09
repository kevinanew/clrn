/** 验证代理复杂度的静态负例及现有 lint 调用链的实际阻断。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repository } from './source-files.mjs';

test('代理支持上限 3、独立工具上限 6 及真实静态入口', /** 仅执行 issue 107 的门禁测试。 */ () => {
  const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12', '--with', 'radon==6.0.1',
    'python', '-m', 'unittest', '-v', 'scripts.test_e2e_proxy_complexity'],
  { cwd: repository, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
