/** 只运行 issue 109 的视觉代理单元测试与独立复杂度门禁负例。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repository } from './source-files.mjs';

/**
 * 在固定 Python 和依赖版本下执行指定模块；不同代理用独立进程隔离同名 addon。
 * @param args - unittest 的定向参数。
 */
function runPython(...args) {
  const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12',
    '--with', 'radon==6.0.1', '--with', 'mitmproxy==12.2.3', 'python', '-m', 'unittest', ...args],
  { cwd: repository, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

for (const scenario of ['club', 'game-record', 'texas-holdem', 'zhajinhua']) {
  test(`视觉代理与回放定向单元测试：${scenario}`, /** 每个场景仅收集同目录 Python 单元测试。 */ () => {
    runPython('discover', '-s', `visual/cases/${scenario}/mitmproxy`, '-p', 'test_*.py');
  });
}

test('视觉代理 Radon 门禁预算、嵌套作用域与实际 lint 入口', /** 临时仓库静态正负例。 */ () => {
  runPython('-v', 'scripts.test_visual_proxy_complexity');
});
