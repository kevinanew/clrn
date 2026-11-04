import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    skipSupport: process.env.VISUAL_SKIP_SUPPORT_TESTS }) + '\\n');
`, { mode: 0o755 });
  try {
    /**
     * 通过伪造 pnpm 捕获视觉启动进程，验证套件隔离而不访问 staging。
     * @param filter - 匹配场景标签的可选正则表达式。
     * @param suite - 本次要启动的套件。
     * @param action - 比较、采集或兼容命令。
     */
    const run = (filter: string, suite = 'all', action = 'test') => {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'run-visual.ts', action], {
        cwd: __dirname, encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          VISUAL_ISOLATION_LOG: log, VISUAL_SUITE: suite, VISUAL_LOCALES: 'zh-Hans',
          VISUAL_SCOPE: 'core', VISUAL_FILTER: filter, VISUAL_ALLOW_HOST: 'true',
          VISUAL_SKIP_VISUAL_INSTALL: 'true', VISUAL_SKIP_SUPPORT_TESTS: 'false' },
      });
      const children = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(/** 将当前条目映射为`JSON.parse(line)`。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
      return { result, children };
    };
    const all = run('');
    assert.equal(all.result.status, 0, all.result.stderr);
    assert.deepEqual(all.children.map(/** 将当前条目映射为`child.suite`。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['app', 'texas', 'zhajinhua']);
    assert.deepEqual(all.children.map(/** 将当前条目映射为`child.skipSupport`。
 * @param child - 当前操作使用的 child。 */ child => child.skipSupport), ['false', 'true', 'true']);
    assert.ok(all.children.every(/** 确认所有条目均满足：`child.args.join(' ') === 'exec tsx run-visual.ts test'`。
 * @param child - 当前操作使用的 child。 */ child => child.args.join(' ') === 'exec tsx run-visual.ts test'));
    const texas = run('signed_in_texas_game$');
    assert.equal(texas.result.status, 0, texas.result.stderr);
    assert.deepEqual(texas.children.map(/** 将当前条目映射为`child.suite`。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['texas']);
    const zhajinhua = run('signed_in_zhajinhua_game$');
    assert.equal(zhajinhua.result.status, 0, zhajinhua.result.stderr);
    assert.deepEqual(zhajinhua.children.map(/** 将当前条目映射为`child.suite`。
 * @param child - 当前操作使用的 child。 */ child => child.suite), ['zhajinhua']);
    const missing = run('never-a-scenario');
    assert.equal(missing.result.status, 1);
    assert.equal(missing.children.length, 0);
    const compare = run('guest_me$', 'app');
    assert.equal(compare.result.status, 0, compare.result.stderr);
    const scenario = compare.children.find(/** 查找满足以下条件的首个条目：`child.args.includes('cases')`。
 * @param child - 当前操作使用的 child。 */ child => child.args.includes('cases'));
    assert.ok(scenario, '必须实际启动所选场景');
    assert.ok(scenario.args.includes('--update-snapshots=none'), '比较入口必须显式只读');
    const approve = run('guest_me$', 'all', 'approve');
    if (process.platform === 'linux') {
      assert.equal(approve.result.status, 0, approve.result.stderr);
      assert.ok(approve.children.every(/** 确认所有条目均满足：`child.args.at(-1) === 'reference'`。
 * @param child - 当前操作使用的 child。 */ child => child.args.at(-1) === 'reference'), '旧命令只作为 reference 别名');
      const reference = run('guest_me$', 'app', 'reference');
      assert.equal(reference.result.status, 0, reference.result.stderr);
      assert.ok(reference.children.find(/** 查找满足以下条件的首个条目：`child.args.includes('cases')`。
 * @param child - 当前操作使用的 child。 */ child => child.args.includes('cases')).args.includes('--update-snapshots=all'));
    } else {
      assert.equal(approve.result.status, 1, '旧命令也必须执行 Linux 采集限制');
      assert.equal(approve.children.length, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
