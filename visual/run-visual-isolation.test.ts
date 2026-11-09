import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('all 入口将 App、德州和拼三张交给独立进程，过滤后不运行空套件', /** 验证all 入口将 App、德州和拼三张交给独立进程，过滤后不运行空套件。 */ () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'visual-run-isolation-'));
  const log = path.join(directory, 'runs.jsonl');
  // 捕获子进程启动边界，不访问 staging、不采集真实凭据。
  writeFileSync(path.join(directory, 'pnpm'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.VISUAL_ISOLATION_LOG,
  JSON.stringify({ suite: process.env.VISUAL_SUITE, args: process.argv.slice(2),
    locale: process.env.VISUAL_LOCALES, username: process.env.VISUAL_USERNAME,
    skipSupport: process.env.VISUAL_SKIP_SUPPORT_TESTS }) + '\\n');
const args = process.argv.slice(2);
const behavior = process.env.VISUAL_ISOLATION_BEHAVIOR;
if (args.includes('src/captureAuthState.ts')) {
  if (behavior === 'fail-auth') process.exit(11);
  require('node:fs').writeFileSync('auth-state.json', '{}');
}
if (args.includes('cases') && behavior === 'fail-cases') process.exit(12);
if (args.includes('run-visual.ts') && process.env.VISUAL_SUITE === 'texas' && behavior === 'fail-suite') process.exit(13);
`, { mode: 0o755 });
  try {
    /**
     * 通过伪造 pnpm 捕获视觉启动进程，验证套件隔离而不访问 staging。
     * @param filter - 匹配场景标签的可选正则表达式。
     * @param suite - 本次要启动的套件。
     * @param action - 比较、采集或兼容命令。
     * @param overrides - 当前用例的环境覆盖及进程故障配置。
     */
    const run = (filter: string, suite = 'all', action = 'test', overrides?: NodeJS.ProcessEnv) => {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'run-visual.ts', action], {
        cwd: __dirname, encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          VISUAL_ISOLATION_LOG: log, VISUAL_SUITE: suite, VISUAL_LOCALES: 'zh-Hans',
          VISUAL_USERNAME: '', VISUAL_PASSWORD: '', VISUAL_DEVICE_ID: '', VISUAL_ISOLATION_BEHAVIOR: '',
          VISUAL_SCOPE: 'core', VISUAL_FILTER: filter, VISUAL_ALLOW_HOST: 'true',
          VISUAL_SKIP_VISUAL_INSTALL: 'true', VISUAL_SKIP_SUPPORT_TESTS: 'false', ...overrides },
      });
      const children = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(/** 解析视觉任务子进程的逐行输出，核对隔离执行配置。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
      return { result, children };
    };
    const all = run('');
    assert.equal(all.result.status, 0, all.result.stderr);
    assert.deepEqual(all.children.map(/** 提取子进程的套件名，检查各视觉套件独立启动。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['app', 'texas', 'zhajinhua']);
    assert.deepEqual(all.children.map(/** 提取支持用例跳过标记，验证任务间的辅助测试隔离。
 * @param child - 当前操作使用的 child。 */ child => child.skipSupport), ['false', 'true', 'true']);
    assert.ok(all.children.every(/** 确认所有条目均满足：`child.args.join(' ') === 'exec tsx run-visual.ts test'`。
 * @param child - 当前操作使用的 child。 */ child => child.args.join(' ') === 'exec tsx run-visual.ts test'));
    const texas = run('signed_in_texas_game$');
    assert.equal(texas.result.status, 0, texas.result.stderr);
    assert.deepEqual(texas.children.map(/** 提取普通视觉任务的套件名，核对执行顺序。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['texas']);
    const zhajinhua = run('signed_in_zhajinhua_game$');
    assert.equal(zhajinhua.result.status, 0, zhajinhua.result.stderr);
    assert.deepEqual(zhajinhua.children.map(/** 提取指定视觉任务的套件名，核对套件筛选结果。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['zhajinhua']);
    const missing = run('never-a-scenario');
    assert.equal(missing.result.status, 1);
    assert.equal(missing.children.length, 0);
    const compare = run('guest_me$', 'app');
    assert.equal(compare.result.status, 0, compare.result.stderr);
    const scenario = compare.children.find(/** 定位视觉案例子进程，核对套件隔离时传入的参数。
 * @param child - 当前操作使用的 child。 */ child => child.args.includes('cases'));
    assert.ok(scenario, '必须实际启动所选场景');
    assert.ok(scenario.args.includes('--update-snapshots=none'), '比较入口必须显式只读');
    const localized = run('guest_me$', 'app', 'test', { VISUAL_LOCALES: 'zh-Hans,en' });
    assert.equal(localized.result.status, 0, localized.result.stderr);
    assert.deepEqual(localized.children.filter(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.args.includes('cases')).map(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.locale),
      ['zh-Hans', 'en'], '逐语言执行不能因第一种语言有匹配就短路');

    const authenticated = run('signed_in_me$', 'app');
    assert.equal(authenticated.result.status, 0, authenticated.result.stderr);
    assert.deepEqual(authenticated.children.map(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.args.at(-1)),
      ['tests', 'src/captureAuthState.ts', '--shard=1/1']);
    assert.equal(authenticated.children[1].username, 'laiwanvisual01');
    assert.equal(existsSync(path.join(__dirname, 'auth-state.json')), false, '成功后必须清理认证文件');

    const failedCases = run('signed_in_me$', 'app', 'test', { VISUAL_ISOLATION_BEHAVIOR: 'fail-cases' });
    assert.equal(failedCases.result.status, 1);
    assert.match(failedCases.result.stderr, /退出码 12/);
    assert.equal(existsSync(path.join(__dirname, 'auth-state.json')), false, '场景失败也必须清理认证文件');

    const failedAuth = run('signed_in_me$', 'app', 'test', { VISUAL_ISOLATION_BEHAVIOR: 'fail-auth' });
    assert.equal(failedAuth.result.status, 1);
    assert.equal(failedAuth.children.filter(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.args.includes('src/captureAuthState.ts')).length, 2);
    assert.equal(failedAuth.children.some(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.args.includes('cases')), false, '认证失败不得启动场景');
    assert.equal(existsSync(path.join(__dirname, 'auth-state.json')), false);

    const failedSuite = run('', 'all', 'test', { VISUAL_ISOLATION_BEHAVIOR: 'fail-suite' });
    assert.equal(failedSuite.result.status, 1);
    assert.match(failedSuite.result.stderr, /texas 视觉测试失败（退出码 13）/);
    assert.deepEqual(failedSuite.children.map(/** 根据当前条目计算结果。
 * @param child - 当前回调参数。 */ child => child.suite), ['app', 'texas']);

    const approve = run('guest_me$', 'all', 'approve');
    if (process.platform === 'linux') {
      assert.equal(approve.result.status, 0, approve.result.stderr);
      assert.ok(approve.children.every(/** 确认所有条目均满足：`child.args.at(-1) === 'reference'`。
 * @param child - 当前操作使用的 child。 */ child => child.args.at(-1) === 'reference'), '旧命令只作为 reference 别名');
      const reference = run('guest_me$', 'app', 'reference');
      assert.equal(reference.result.status, 0, reference.result.stderr);
      assert.ok(reference.children.find(/** 定位视觉案例子进程，核对指定分片的执行配置。
 * @param child - 当前操作使用的 child。 */ child => child.args.includes('cases')).args.includes('--update-snapshots=all'));
    } else {
      assert.equal(approve.result.status, 1, '旧命令也必须执行 Linux 采集限制');
      assert.equal(approve.children.length, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
