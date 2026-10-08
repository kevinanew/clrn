import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('all 入口将 App 和德州交给独立进程，过滤后不运行空套件', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'visual-run-isolation-'));
  const log = path.join(directory, 'runs.jsonl');
  // 捕获子进程启动边界，不访问 staging、不采集真实凭据。
  writeFileSync(path.join(directory, 'pnpm'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.VISUAL_ISOLATION_LOG,
  JSON.stringify({ suite: process.env.VISUAL_SUITE, args: process.argv.slice(2),
    skipSupport: process.env.VISUAL_SKIP_SUPPORT_TESTS }) + '\\n');
`, { mode: 0o755 });
  try {
    const run = (filter: string) => {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'run-visual.ts', 'test'], {
        cwd: __dirname, encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          VISUAL_ISOLATION_LOG: log, VISUAL_SUITE: 'all', VISUAL_LOCALES: 'zh-Hans',
          VISUAL_SCOPE: 'core', VISUAL_FILTER: filter, VISUAL_ALLOW_HOST: 'true',
          VISUAL_SKIP_VISUAL_INSTALL: 'true', VISUAL_SKIP_SUPPORT_TESTS: 'false' },
      });
      const children = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      return { result, children };
    };
    const all = run('');
    assert.equal(all.result.status, 0, all.result.stderr);
    assert.deepEqual(all.children.map(child => child.suite), ['app', 'texas']);
    assert.deepEqual(all.children.map(child => child.skipSupport), ['false', 'true']);
    assert.ok(all.children.every(child => child.args.join(' ') === 'exec tsx run-visual.ts test'));
    const texas = run('signed_in_texas_game$');
    assert.equal(texas.result.status, 0, texas.result.stderr);
    assert.deepEqual(texas.children.map(child => child.suite), ['texas']);
    const missing = run('never-a-scenario');
    assert.equal(missing.result.status, 1);
    assert.equal(missing.children.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
