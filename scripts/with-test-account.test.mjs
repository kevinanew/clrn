/** 验证本机账号独占、退出清理及拒绝全部 CI 专用账号。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
    accounts: usernames.map(/** 将当前条目映射为`{ username, password: 'mock-password', userId: '11111111-2222-4333-8444-555555555555', }`。
 * @param username - 当前操作使用的 username。 */ username => ({
      username, password: 'mock-password', userId: '11111111-2222-4333-8444-555555555555',
    })),
  }), { mode: 0o600 });
  t.after(/** 账号运行器测试结束后删除临时目录。 */ () => rm(directory, { recursive: true, force: true }));
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
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./account-network-fixture.mjs', import.meta.url)), launcher, '--', ...command], {
    env: { ...process.env, CLRN_TEST_ACCOUNT_POOL: pool, GITHUB_ENV: '', TESTING_API_TOKEN: 'test-only-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', /** 收集被测命令的标准输出。
 * @param chunk - 本次读取的数据块。 */ chunk => { stdout += chunk; });
  child.stderr.on('data', /** 收集被测命令的标准错误。
 * @param chunk - 本次读取的数据块。 */ chunk => { stderr += chunk; });
  const finished = once(child, 'exit').then(/** 将异步结果转换为`{ code, stdout, stderr }`，供后续步骤使用。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ([code]) => ({ code, stdout, stderr }));
  t.after(/** 用例结束时终止仍在运行的命令并等待进程退出。 */ async () => {
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

test('并发任务独占不同账号，池耗尽时失败，结束后可复用', { timeout: 10000 }, /** 验证并发任务独占不同账号，池耗尽时失败，结束后可复用。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { directory, pool } = await fixture(t);
  const first = await hold(t, pool);
  const second = await hold(t, pool);
  assert.notEqual(first.identity.username, second.identity.username);
  const prepared = (await readFile(join(directory, 'prepared-accounts'), 'utf8')).trim().split('\n');
  assert.deepEqual(prepared.sort(), [first.identity.username, second.identity.username].sort());
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

test('测试命令失败时保留退出码并释放账号', { timeout: 10000 }, /** 验证测试命令失败时保留退出码并释放账号。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { directory, pool } = await fixture(t, ['parallel01']);
  const run = launch(t, pool, [process.execPath, '-e', 'process.exit(7)']);
  assert.equal((await run.finished).code, 7);
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});

test('命令无法启动时也释放账号', { timeout: 10000 }, /** 验证命令无法启动时也释放账号。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { directory, pool } = await fixture(t, ['parallel01']);
  const run = launch(t, pool, [join(directory, 'missing-command')]);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /启动失败/);
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});

test('同一用户名的大小写变体不能作为两个账号分配', { timeout: 10000 }, /** 验证同一用户名的大小写变体不能作为两个账号分配。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { pool } = await fixture(t, ['parallel01', 'PARALLEL01']);
  const run = launch(t, pool, [process.execPath, '-e', 'process.exit(0)']);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /重复用户名/);
});

test('超过 H5 输入长度的密码在启动测试前被拒绝且不泄露', /** 验证超过 H5 输入长度的密码在启动测试前被拒绝且不泄露。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { pool } = await fixture(t, ['parallel01']);
  const password = 'SensitivePasswordTooLong';
  await writeFile(pool, JSON.stringify({ accounts: [{ username: 'parallel01', password, userId: 'mock-user' }] }));
  const run = launch(t, pool, [process.execPath, '-e', 'console.log("SHOULD_NOT_START")']);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /密码不兼容 H5/);
  assert.ok(!result.stderr.includes(password));
  assert.ok(!result.stdout.includes('SHOULD_NOT_START'));
});

test('30 个并发任务使用 30 个不同账号，第 31 个任务不能复用', { timeout: 30000 }, /** 验证30 个并发任务使用 30 个不同账号，第 31 个任务不能复用。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const usernames = Array.from({ length: 30 }, /** 为当前索引构造`parallel${String(index + 1).padStart(2, '0')}`。
 * @param _ - 当前操作使用的 _。
 * @param index - 当前条目在集合中的位置。 */ (_, index) => `parallel${String(index + 1).padStart(2, '0')}`);
  const { directory, pool } = await fixture(t, usernames);
  const runs = await Promise.all(usernames.map(/** 将当前条目映射为`hold(t, pool)`。 */ () => hold(t, pool)));
  assert.equal(new Set(runs.map(/** 将当前条目映射为`run.identity.username`。
 * @param run - 当前操作使用的 run。 */ run => run.identity.username)).size, 30);
  const extra = launch(t, pool, [process.execPath, '-e', 'process.exit(0)']);
  const unavailable = await extra.finished;
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.stderr, /全部被占用/);
  runs.forEach(/** 向并行运行的测试进程发送终止信号，验证进程组清理。
 * @param run - 当前操作使用的 run。 */ run => run.child.kill('SIGTERM'));
  await Promise.all(runs.map(/** 将当前条目映射为`run.finished`。
 * @param run - 当前操作使用的 run。 */ run => run.finished));
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});


test('本机启动器拒绝 CI 专用账号，包括大小写变体', /** 验证本机启动器拒绝 CI 专用账号，包括大小写变体。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  for (const username of ['clrnci26100908', 'CLRNCI26100908', 'clrnci261018001', 'CLRNCI261018070']) {
    const { pool } = await fixture(t, [username]);
    const run = launch(t, pool, [process.execPath, '-e', 'console.log("SHOULD_NOT_START")']);
    const result = await run.finished;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /禁止使用 CLRN 的 CI 专用账号/);
    assert.ok(!result.stdout.includes('SHOULD_NOT_START'));
  }
});


test('余额准备失败不启动测试命令，并释放账号锁', /** 验证余额准备失败不启动测试命令，并释放账号锁。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  const { directory, pool } = await fixture(t, ['parallel01']);
  await writeFile(join(directory, 'reject-wallet'), '');
  const run = launch(t, pool, [process.execPath, '-e', 'console.log("SHOULD_NOT_START")']);
  const result = await run.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /准备账号登录失败/);
  assert.ok(!result.stdout.includes('SHOULD_NOT_START'));
  assert.ok(!result.stderr.includes('private-token'));
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});


test('房间准备失败不启动测试命令，并释放账号锁', /** 验证房间准备失败不启动测试命令，并释放账号锁。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { directory, pool } = await fixture(context, ['parallel01']);
  await writeFile(join(directory, 'reject-wallet'), '/v2/building/rooms');
  const result = await launch(context, pool, [process.execPath, '-e', 'console.log("SHOULD_NOT_START")']).finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /method=PUT operation=prepare-room-list source=laiwan_proxy status=401 response=received reason=http-error/);
  assert.ok(!result.stdout.includes('SHOULD_NOT_START'));
  assert.deepEqual(await readdir(join(directory, 'locks')), []);
});
