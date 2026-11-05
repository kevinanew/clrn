import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { physicalLines, scanPythonLines } from './python-lines.mjs';
import { repository } from './source-files.mjs';

/**
 * 创建临时 Git 仓库，复制真实 CLI 及其文件发现模块以隔离验证。
 *
 * @param context - 用于注册清理的测试上下文。
 * @returns 临时仓库根目录。
 */
function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-python-lines-'));
  context.after(/** 清理临时仓库。 */ () => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', directory]);
  mkdirSync(join(directory, 'scripts'));
  for (const file of ['python-lines.mjs', 'source-files.mjs']) {
    copyFileSync(join(repository, 'scripts', file), join(directory, 'scripts', file));
  }
  return directory;
}

/**
 * 写入任意层级的样例路径。
 *
 * @param directory - 临时仓库根目录。
 *
 * @param file - 相对路径。
 *
 * @param contents - 样例源码。
 */
function write(directory, file, contents) {
  const target = join(directory, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/**
 * 执行真实扫描命令并保留状态与诊断。
 *
 * @param directory - 临时仓库根目录。
 *
 * @param environment - 子进程环境。
 * @returns 原始命令执行结果。
 */
function cli(directory, environment = process.env) {
  return spawnSync(process.execPath, [join(directory, 'scripts/python-lines.mjs')],
    { cwd: directory, env: environment, encoding: 'utf8' });
}

test('物理行包含空行、注释与 docstring，正确处理空文件和所有 Python 换行', /** 验证物理行计数。 */ () => {
  for (const [source, expected] of [['', 0], ['\n', 1], ['# comment', 1], ['\n\n', 2],
    ['"""doc\nstring"""\n\n# comment\n', 4], ['\f\v', 1]]) {
    assert.equal(physicalLines(source), expected);
  }
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const length of [500, 501]) {
      assert.equal(physicalLines(`# comment${newline}`.repeat(length)), length);
      assert.equal(physicalLines(Array(length).fill('# comment').join(newline)), length);
    }
  }
});

test('CLI 的 500 行通过，501 行报告路径、实测值及上限并失败', /** 验证扫描行为。
 * @param context - 测试上下文。 */ context => {
  const directory = fixture(context);
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const ending of ['', newline]) {
      write(directory, 'nested/with space.py', Array(500).fill('# line').join(newline) + ending);
      const valid = cli(directory);
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /扫描 1 个文件；最长 nested\/with space\.py: 500 行/);
      write(directory, 'nested/with space.py', Array(501).fill('# line').join(newline) + ending);
      const invalid = cli(directory);
      assert.equal(invalid.status, 1, invalid.stderr);
      assert.match(invalid.stderr, /nested\/with space\.py: 501 行（上限 500 行）/);
    }
  }
});

test('扫描跟踪、未忽略的新文件及嵌套目录；忽略删除和既有排除目录', /** 验证扫描行为。
 * @param context - 测试上下文。 */ context => {
  const directory = fixture(context);
  write(directory, '.gitignore', '*.ignored.py\n__pycache__/\n.ruff_cache/\n');
  write(directory, 'tracked.py', '# tracked\n');
  write(directory, 'deleted.py', '# deleted\n');
  const excluded = ['node_modules', '.venv', 'test-results', 'playwright-report',
    'blob-report', 'snapshots', '.ttyctl'];
  for (const name of excluded) write(directory, `nested/${name}/generated.py`, '\n'.repeat(501));
  execFileSync('git', ['add', '.'], { cwd: directory });
  rmSync(join(directory, 'deleted.py'));
  // 即使已跟踪文件匹配后来新增的忽略规则，也必须扫描。
  write(directory, '.gitignore', '*.py\n!new/\n!new/**/*.py\n__pycache__/\n.ruff_cache/\n');
  write(directory, 'new/deep/name\nwith space.py', '\n'.repeat(501));
  write(directory, 'hidden.ignored.py', '\n'.repeat(501));
  write(directory, 'nested/__pycache__/cache.py', '\n'.repeat(501));
  write(directory, 'nested/.ruff_cache/cache.py', '\n'.repeat(501));
  write(directory, 'new/empty.py', '');
  write(directory, 'new/ignored.txt', '\n'.repeat(501));
  const report = scanPythonLines(directory);
  assert.equal(report.count, 3);
  assert.deepEqual(report.longest, { file: 'new/deep/name\nwith space.py', lines: 501 });
  assert.deepEqual(report.violations, [report.longest]);
  write(directory, 'new/deep/name\nwith space.py', '# below limit');
  assert.deepEqual(scanPythonLines(directory).violations, []);
});

test('空文件可扫描，空扫描、读取失败、Git 缺失及非 Git 目录均失败', /** 验证扫描行为。
 * @param context - 测试上下文。 */ context => {
  const directory = fixture(context);
  assert.equal(cli(directory).status, 1);
  assert.match(cli(directory).stderr, /没有扫描到源码/);
  write(directory, 'empty.py', '');
  assert.deepEqual(scanPythonLines(directory), {
    count: 1, longest: { file: 'empty.py', lines: 0 }, violations: [],
  });
  assert.equal(cli(directory).status, 0);
  symlinkSync('missing-target', join(directory, 'broken.py'));
  const broken = cli(directory);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /ENOENT.*broken\.py/);
  rmSync(join(directory, 'broken.py'));
  const missingGit = cli(directory, { ...process.env, PATH: '' });
  assert.equal(missingGit.status, 1);
  assert.match(missingGit.stderr, /git.*ENOENT/);
  // 用 Git 跟踪路径后替换为目录，稳定触发真正的读取异常。
  execFileSync('git', ['add', 'empty.py'], { cwd: directory });
  rmSync(join(directory, 'empty.py'));
  mkdirSync(join(directory, 'empty.py'));
  assert.equal(cli(directory).status, 1);
  assert.match(cli(directory).stderr, /EISDIR/);
  rmSync(join(directory, '.git'), { recursive: true, force: true });
  assert.equal(cli(directory).status, 1);
  assert.match(cli(directory).stderr, /not a git repository/);
});

test('不可读的源码不能被静默跳过', { skip: process.getuid?.() === 0 }, /** 验证扫描行为。
 * @param context - 测试上下文。 */ context => {
  const directory = fixture(context);
  write(directory, 'unreadable.py', '# content');
  chmodSync(join(directory, 'unreadable.py'), 0o000);
  const result = cli(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EACCES/);
});

test('真实 Python 静态入口阻断未跟踪的 501 行 Python 文件', /** 验证扫描行为。
 * @param context - 测试上下文。 */ context => {
  const directory = fixture(context);
  copyFileSync(join(repository, 'package.json'), join(directory, 'package.json'));
  write(directory, 'probe.py', '# line\n'.repeat(501));
  const result = spawnSync('npm', ['run', 'lint:python'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /probe\.py: 501 行（上限 500 行）/);
});
