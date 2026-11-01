/** 验证 100 个 Web 账号轮转、本机隔离、完整凭据及工作流注入。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { allocateCiAccount, ciAccountCredentials, ciAccounts, visualAccountMatrix, animationAccountMatrix } from './ci-accounts.mjs';

test('连续 100 个运行 ID 轮转完整 Web 账号池，重跑和大整数 ID 分配稳定', () => {
  assert.equal(new Set(Array.from({length:100},(_,i)=>allocateCiAccount(String(100+i)))).size,100);
  assert.equal(allocateCiAccount('90071992547409931'), allocateCiAccount('90071992547409931'));
  assert.equal(allocateCiAccount('90071992547409931'), ciAccounts[Number(90071992547409931n % 100n)]);
  for (const id of ['', '1\n', 'abc', '-1', undefined]) assert.throws(()=>allocateCiAccount(id));
  for (const offset of [-1,100,0.5]) assert.throws(()=>allocateCiAccount('1',offset));
});

test('全量视觉矩阵九个任务使用九个账号，单套件筛选保留原账号槽位', () => {
  const full=visualAccountMatrix('29','all',true).include;
  assert.equal(full.length,9);
  assert.equal(new Set(full.map(item=>item.account)).size,9);
  assert.equal(visualAccountMatrix('29').include.length,3);
  assert.deepEqual(visualAccountMatrix('29').include.map(item => item.suite), ['texas', 'zhajinhua', 'app']);
  assert.deepEqual(full.map(item => `${item.suite}/${item.locale}`),
    ['texas', 'zhajinhua', 'app'].flatMap(suite => ['zh-Hans', 'zh-Hant', 'en'].map(locale => `${suite}/${locale}`)));
  for (const item of full) {
    const offset = { app: 0, texas: 3, zhajinhua: 6 }[item.suite] + ['zh-Hans', 'zh-Hant', 'en'].indexOf(item.locale);
    assert.equal(item.account, allocateCiAccount('29', offset));
  }
  for (const suite of ['app','texas','zhajinhua']) {
    assert.deepEqual(visualAccountMatrix('29',suite,true).include,full.filter(item=>item.suite===suite));
  }
  assert.throws(()=>visualAccountMatrix('29','typo'));
});

test('同一运行编号下 Web 的 19 个任务不重复分配账号', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-deployment-accounts-'));
  const accounts = visualAccountMatrix('99', 'all', true).include
    .map(item => item.account);
  try {
    for (const mode of ['e2e', 'functional', 'interactions']) {
      const output = join(directory, mode);
      const result = spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', mode], {
        encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '99' },
      });
      assert.equal(result.status, 0, result.stderr);
      accounts.push(readFileSync(output, 'utf8').trim().replace('account=', ''));
    }
    const output = join(directory, 'animations');
    const result = spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', 'animations'], {
      encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '99' },
    });
    assert.equal(result.status, 0, result.stderr);
    const matrix = JSON.parse(readFileSync(output, 'utf8').slice('matrix='.length));
    assert.deepEqual(matrix, animationAccountMatrix('99'));
    assert.deepEqual(matrix.include.map(item => `${item.suite}/${item.part}`),
      ['app/application', 'app/ui',
        'texas/table', 'texas/gameplay', 'texas/social',
        'zhajinhua/panels', 'zhajinhua/gameplay']);
    accounts.push(...matrix.include.map(item => item.account));
    assert.equal(accounts.length, 19);
    assert.equal(new Set(accounts).size, 19);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('动画单套件筛选保留账号槽位，调度入口支持选择且拒绝未知套件', () => {
  const full = animationAccountMatrix('99').include;
  const directory = mkdtempSync(join(tmpdir(), 'clrn-animation-accounts-'));
  try {
    for (const suite of ['app', 'texas', 'zhajinhua']) {
      const expected = { include: full.filter(item => item.suite === suite) };
      assert.deepEqual(animationAccountMatrix('99', suite), expected);
      const output = join(directory, suite);
      const result = spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', 'animations'], {
        encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '99', CI_ANIMATION_SUITE: suite },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(output, 'utf8').slice('matrix='.length)), expected);
    }
    assert.throws(() => animationAccountMatrix('99', 'typo'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('凭据按公开账号名读取，不依赖 Secret 排序，错误不包含密码', () => {
  const password='SensitiveTest1234';
  const accounts=ciAccounts.map(username=>({username,password,status:'ready'}));
  assert.deepEqual(ciAccountCredentials(JSON.stringify({accounts:[...accounts].reverse()}),ciAccounts[5]),{username:ciAccounts[5],password});
  for (const invalid of [password,JSON.stringify({accounts:accounts.slice(1)}),
    JSON.stringify({accounts:[accounts[0],...accounts.slice(0,-1)]}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,status:'registered'}:a)}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,password:'x'.repeat(21)}:a)}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,password:'injected\nKEY=value'}:a)})]) {
    assert.throws(()=>ciAccountCredentials(invalid,ciAccounts[5]), error=>!error.message.includes(password));
  }
  assert.throws(()=>ciAccountCredentials(JSON.stringify({accounts}),'laiwanvisual01'));
});

test('Actions 调度输出与注入凭据一致，只导出一个账号，配置缺失时拒绝默认账号', () => {
  const directory=mkdtempSync(join(tmpdir(),'ci-account-env-'));
  const output=join(directory,'outputs');
  const environment=join(directory,'environment');
  try {
    for (const mode of ['e2e', 'functional', 'interactions']) {
      writeFileSync(output, '');
      const accountPlan = spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', mode], {
        encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ID: '29', GITHUB_OUTPUT: output },
      });
      assert.equal(accountPlan.status, 0, accountPlan.stderr);
      assert.equal(readFileSync(output, 'utf8'), `account=${allocateCiAccount('29', { e2e: 9, functional: 10, interactions: 11 }[mode])}\n`);
    }
    writeFileSync(output, '');
    const planned=spawnSync(process.execPath,['scripts/plan-ci-accounts.mjs','visual'],{
      encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'29',GITHUB_OUTPUT:output,CI_VISUAL_FULL:'true'},
    });
    assert.equal(planned.status,0,planned.stderr);
    const {include}=JSON.parse(readFileSync(output,'utf8').slice('matrix='.length));
    const selected=include[0].account;
    const accounts=ciAccounts.map((username,i)=>({username,password:`FakePassword${i}123`,status:'ready'}));
    const configured=spawnSync(process.execPath,['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kevinanew/clrn',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:JSON.stringify({accounts}),TESTING_API_TOKEN:'test-token'},
    });
    assert.equal(configured.status,0,configured.stderr);
    assert.equal(readFileSync(join(directory, 'prepared-accounts'), 'utf8'), `${selected}\n`);
    const values=Object.fromEntries(readFileSync(environment,'utf8').trim().split('\n').map(line=>{
      const delimiter=line.indexOf('=');return [line.slice(0,delimiter),line.slice(delimiter+1)];
    }));
    const password=accounts.find(account=>account.username===selected).password;
    for(const prefix of ['E2E_TEST','E2E_CREATION','VISUAL']) {
      assert.equal(values[`${prefix}_USERNAME`],selected);
      assert.equal(values[`${prefix}_PASSWORD`],password);
    }
    assert.equal(Object.keys(values).length,6);
    assert.ok(configured.stdout.includes(`::add-mask::${password}`));
    assert.ok(!configured.stdout.includes(accounts.find(account=>account.username!==selected).password));
    for (const failedPath of ['/set_balance/testing', '/v10/wallet/', '/v10/house/user/', '/v2/building/rooms']) {
      writeFileSync(environment, '');
      writeFileSync(join(directory, 'reject-wallet'), failedPath);
      const rejected = spawnSync(process.execPath,
        ['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'], {
          encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
            GITHUB_REPOSITORY: 'kevinanew/clrn', GITHUB_ENV: environment, TESTING_API_TOKEN: 'test-token',
            CLRN_CI_ACCOUNT: selected, CLRN_CI_TEST_ACCOUNTS: JSON.stringify({ accounts }) },
        });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /失败：method=(POST|PUT) operation=(prepare-account|prepare-room)-[a-z-]+ source=laiwan_prd status=401 response=received reason=http-error/);
      assert.equal(readFileSync(environment, 'utf8'), '');
      assert.ok(!rejected.stderr.includes('private-token'));
    }
    rmSync(join(directory, 'reject-wallet'));
    writeFileSync(environment, '');
    const foreignRepository = spawnSync(process.execPath, ['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'], {
      encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'kevinanew/laiwan_react_native', GITHUB_ENV: environment,
        CLRN_CI_ACCOUNT: selected, CLRN_CI_TEST_ACCOUNTS: JSON.stringify({ accounts }) },
    });
    assert.notEqual(foreignRepository.status, 0);
    assert.match(foreignRepository.stderr, /只允许在 kevinanew\/clrn/);
    assert.equal(readFileSync(environment, 'utf8'), '');
    assert.ok(!foreignRepository.stdout.includes(password));
    const missing=spawnSync(process.execPath,['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kevinanew/clrn',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:''},
    });
    assert.notEqual(missing.status,0);
    assert.equal(readFileSync(environment,'utf8'),'');
  } finally {rmSync(directory,{recursive:true,force:true});}
});


test('公开清单仅含 100 个 Web 账号，凭据必须完整且不能混入池外账号', () => {
  const expected = [
    ...Array.from({ length: 30 }, (_, index) => `clrnci261009${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 70 }, (_, index) => `clrnci261018${String(index + 1).padStart(3, '0')}`),
  ];
  assert.deepEqual(ciAccounts, expected);
  const accounts = ciAccounts.map(username => ({ username, password: 'AccountPool123', status: 'ready' }));
  const serialized = JSON.stringify({ accounts });
  for (const username of expected) {
    assert.equal(ciAccountCredentials(serialized, username).username, username);
  }
  assert.throws(() => ciAccountCredentials(serialized, 'unmanagedaccount'));
  assert.throws(() => ciAccountCredentials(JSON.stringify({ accounts: accounts.slice(0, 30) }), ciAccounts[0]));
  const foreign = { username: 'unmanagedaccount', password: 'AccountPool123', status: 'ready' };
  assert.throws(() => ciAccountCredentials(JSON.stringify({ accounts: [...accounts.slice(0, -1), foreign] }), ciAccounts[0]));
  assert.throws(() => ciAccountCredentials(JSON.stringify({ accounts: [...accounts, foreign] }), ciAccounts[0]));
});

test('五组工作流统一引用新版 Web 凭据并保留账号互斥', () => {
  for (const workflow of ['e2e', 'functional', 'interactions', 'visual', 'animations']) {
    const source = readFileSync(`.github/workflows/${workflow}.yml`, 'utf8');
    assert.match(source, /secrets\.CLRN_CI_TEST_ACCOUNTS_V3/);
    assert.doesNotMatch(source, /secrets\.CLRN_CI_TEST_ACCOUNTS_V2/);
    assert.match(source, /group: h5-staging-account-/);
    assert.match(source, /cancel-in-progress: false/);
    assert.match(source, /queue: max/);
  }
});
