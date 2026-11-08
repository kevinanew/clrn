/** 验证 Python 工具定向测试及实际静态入口的阻断行为。 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { repository } from './source-files.mjs';

test('解包、hook 准备与 Radon 门禁的定向 Python 单元测试', /** 仅运行本次修改涉及的三个单元测试模块。 */ () => {
  const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12', '--with', 'radon==6.0.1',
    'python', '-m', 'unittest', '-v', 'scripts.test_extract_web_package',
    'scripts.test_verify_pre_commit', 'scripts.test_python_tool_complexity'],
  { cwd: repository, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('实际 lint:python 入口阻断超限测试支持代码', /** 在临时仓库验证现有静态调用链。
 * @param context - 测试清理上下文。 */ context => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-python-tools-'));
  context.after(/** 清理一次性仓库。 */ () => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', directory]);
  mkdirSync(join(directory, 'scripts'));
  copyFileSync(join(repository, 'package.json'), join(directory, 'package.json'));
  for (const file of ['python-lines.mjs', 'source-files.mjs', 'python-tool-complexity.py']) {
    copyFileSync(join(repository, 'scripts', file), join(directory, 'scripts', file));
  }
  writeFileSync(join(directory, 'scripts/extract-web-package.py'), 'def extract(): pass\n');
  writeFileSync(join(directory, 'scripts/verify-pre-commit.py'),
    'def fixture(flag):\n' + '    if flag: pass\n'.repeat(3));
  const result = spawnSync('npm', ['run', 'lint:python'], { cwd: directory, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /verify-pre-commit\.py:1:1 fixture: 复杂度 4（上限 3）/);
});
