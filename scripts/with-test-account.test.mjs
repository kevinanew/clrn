import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('./with-test-account.mjs', import.meta.url));

/**
 * 创建独立的虚拟账号池，测试完成后删除临时目录，不连接真实服务。
 *
 * @param t - Node 测试上下文，用于注册清理操作。
 * @param usernames - 本项测试所需的虚拟用户名。
 * @returns 临时目录及账号池文件路径。
 */
async function fixture(t, usernames = ['parallel01', 'parallel02']) {
  const directory = await mkdtemp(join(tmpdir(), 'clrn-account-lock-test-'));
  const pool = join(directory, 'accounts.json');
  await writeFile(pool, JSON.stringify({
    accounts: usernames.map((username, index) => ({
      username, password: 'mock-password', userId: `mock-user-${index}`,
    })),
  }), { mode: 0o600 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, pool };
}

/**
 * 用指定虚拟账号池启动分配器，收集退出状态，并在测试结束后停止遗留进程。
 *
 * @param t - Node 测试上下文，用于注册进程清理操作。
 * @param pool - 虚拟账号池文件路径。
 * @param command - 分配器需要执行的命令及参数。
 * @returns 子进程及等待其退出的 Promise。
 */
function launch(t, pool, command) {
  const child = spawn(process.execPath, [launcher, '--', ...command], {
    env: { ...process.env, CLRN_TEST_ACCOUNT_POOL: pool },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const finished = once(child, 'exit').then(([code]) => ({ code, stdout, stderr }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await finished;
  });
  return { child, finished };
}

/**
 * 启动持续运行的虚拟测试，以便检查其他任务能否同时取得不同账号。
 *
 * @param t - Node 测试上下文，用于注册清理操作。
 * @param pool - 虚拟账号池文件路径。
 * @returns 子进程、退出等待器及子进程实际收到的账号配置。
 */
async function hold(t, pool) {
  const run = launch(t, pool, [process.execPath, '-e', `
    console.log(JSON.stringify({
      username: process.env.E2E_TEST_USERNAME,
      creation: process.env.E2E_CREATION_USERNAME,
      visual: process.env.VISUAL_USERNAME,
      samePassword: process.env.E2E_TEST_PASSWORD === process.env.E2E_CREATION_PASSWORD
        && process.env.E2E_TEST_PASSWORD === process.env.VISUAL_PASSWORD,
      creationState: process.env.E2E_CREATION_STORAGE_STATE_FILE || null,
    }));
    setInterval(() => {}, 1000);
  `]);
  const [output] = await once(run.child.stdout, 'data');
  return { ...run, identity: JSON.parse(output.toString()) };
}

test('并发任务独占不同账号，池耗尽时失败，结束后可复用', { timeout: 10000 }, async t => {
  const { directory, pool } = await fixture(t);
  const first = await hold(t, pool);
  const second = await hold(t, pool);
  assert.notEqual(first.identity.username, second.identity.username);
  for (const run of [first, second]) {
    assert.equal(run.identity.creation, run.identity.username);
    assert.equal(run.identity.visual, run.identity.username);
    assert.equal(run.identity.samePassword, true);
    assert.equal(run.identity.creationState, null);
  }
  const third = launch(t, pool, [process.execPath, '-e', 'process.exit(0)']);
  const unavailable = await third.finished;
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.stderr, /全部被占用/);
  first.child.kill('SIGTERM');
  await first.finished;
  assert.equal((await readdir(join(directory, 'locks'))).length, 1);
  const next = await hold(t, pool);
  assert.equal(next.identity.username, first.identity.username);
  second.child.kill('SIGTERM');
  next.child.kill('SIGTERM');
  await Promise.all([second.finished, next.finished]);
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});

test('测试命令失败时保留退出码并释放账号', { timeout: 10000 }, async t => {
  const { directory, pool } = await fixture(t, ['parallel01']);
  const run = launch(t, pool, [process.execPath, '-e', 'process.exit(7)']);
  assert.equal((await run.finished).code, 7);
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});

test('命令无法启动时也释放账号', { timeout: 10000 }, async t => {
  const { directory, pool } = await fixture(t, ['parallel01']);
  const run = launch(t, pool, [join(directory, 'missing-command')]);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /启动失败/);
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});

test('同一用户名的大小写变体不能作为两个账号分配', { timeout: 10000 }, async t => {
  const { pool } = await fixture(t, ['parallel01', 'PARALLEL01']);
  const run = launch(t, pool, [process.execPath, '-e', 'process.exit(0)']);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /重复用户名/);
});

test('30 个并发任务使用 30 个不同账号，第 31 个任务不能复用', { timeout: 30000 }, async t => {
  const usernames = Array.from({ length: 30 }, (_, index) => `parallel${String(index + 1).padStart(2, '0')}`);
  const { directory, pool } = await fixture(t, usernames);
  const runs = await Promise.all(usernames.map(() => hold(t, pool)));
  assert.equal(new Set(runs.map(run => run.identity.username)).size, 30);
  const extra = launch(t, pool, [process.execPath, '-e', 'process.exit(0)']);
  const unavailable = await extra.finished;
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.stderr, /全部被占用/);
  runs.forEach(run => run.child.kill('SIGTERM'));
  await Promise.all(runs.map(run => run.finished));
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});
