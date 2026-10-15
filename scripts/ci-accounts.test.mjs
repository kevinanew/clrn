import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { allocateCiAccount, ciAccountCredentials, ciAccounts, executionAccounts, visualAccountMatrix } from './ci-accounts.mjs';

test('连续 30 个运行 ID 只轮转 Web 老账号，重跑和大整数 ID 分配稳定', () => {
  assert.equal(new Set(Array.from({length:30},(_,i)=>allocateCiAccount(String(100+i)))).size,30);
  assert.equal(allocateCiAccount('90071992547409931'), allocateCiAccount('90071992547409931'));
  assert.equal(allocateCiAccount('90071992547409931'), executionAccounts[Number(90071992547409931n % 30n)]);
  for (const id of ['', '1\n', 'abc', '-1', undefined]) assert.throws(()=>allocateCiAccount(id));
  for (const offset of [-1,30,0.5]) assert.throws(()=>allocateCiAccount('1',offset));
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

test('同一运行编号下 Web 的 12 个任务不重复分配账号', () => {
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
    assert.equal(new Set(accounts).size, 12);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    for (const failedPath of ['/set_balance/testing', '/v10/wallet/']) {
      writeFileSync(environment, '');
      writeFileSync(join(directory, 'reject-wallet'), failedPath);
      const rejected = spawnSync(process.execPath,
        ['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'], {
          encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
            GITHUB_REPOSITORY: 'kevinanew/clrn', GITHUB_ENV: environment, TESTING_API_TOKEN: 'test-token',
            CLRN_CI_ACCOUNT: selected, CLRN_CI_TEST_ACCOUNTS: JSON.stringify({ accounts }) },
        });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /失败（HTTP 401）/);
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


test('仓库账号分区固定，不能选用另一仓库账号，接受分区凭据', () => {
  assert.equal(executionAccounts.length, 30);
  const reserved = ciAccounts.slice(30);
  const accounts = executionAccounts.map(username => ({ username, password: 'Partition123', status: 'ready' }));
  const serialized = JSON.stringify({ accounts });
  for (let run = 0; run < 200; run += 1) {
    assert.ok(!reserved.includes(allocateCiAccount(String(run))));
  }
  assert.equal(ciAccountCredentials(serialized, executionAccounts[0]).username, executionAccounts[0]);
  assert.throws(() => ciAccountCredentials(serialized, reserved[0]));
  const full = JSON.stringify({ accounts: ciAccounts.map(username => ({ username, password: 'Partition123', status: 'ready' })) });
  assert.throws(() => ciAccountCredentials(full, reserved[0]));
});
