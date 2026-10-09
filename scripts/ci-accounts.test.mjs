import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { allocateCiAccount, ciAccountCredentials, ciAccounts, visualAccountMatrix } from './ci-accounts.mjs';

test('连续 30 个运行 ID 轮转全部账号，重跑和大整数 ID 分配稳定', () => {
  assert.equal(new Set(Array.from({length:30},(_,i)=>allocateCiAccount(String(100+i)))).size,30);
  assert.equal(allocateCiAccount('90071992547409931'), allocateCiAccount('90071992547409931'));
  assert.equal(allocateCiAccount('90071992547409931'), ciAccounts[Number(90071992547409931n % 30n)]);
  for (const id of ['', '1\n', 'abc', '-1', undefined]) assert.throws(()=>allocateCiAccount(id));
  for (const offset of [-1,30,0.5]) assert.throws(()=>allocateCiAccount('1',offset));
});

test('全量视觉矩阵九个任务使用九个账号，单套件筛选保留原账号槽位', () => {
  const full=visualAccountMatrix('29','all',true).include;
  assert.equal(full.length,9);
  assert.equal(new Set(full.map(item=>item.account)).size,9);
  assert.equal(visualAccountMatrix('29').include.length,3);
  for (const suite of ['app','texas','zhajinhua']) {
    assert.deepEqual(visualAccountMatrix('29',suite,true).include,full.filter(item=>item.suite===suite));
  }
  assert.throws(()=>visualAccountMatrix('29','typo'));
});

test('凭据按公开账号名读取，不依赖 Secret 排序，错误不包含密码', () => {
  const password='SensitiveTest1234';
  const accounts=ciAccounts.map(username=>({username,password,status:'ready'}));
  assert.deepEqual(ciAccountCredentials(JSON.stringify({accounts:[...accounts].reverse()}),ciAccounts[5]),{username:ciAccounts[5],password});
  for (const invalid of [password,JSON.stringify({accounts:accounts.slice(1)}),
    JSON.stringify({accounts:[accounts[0],...accounts.slice(0,29)]}),
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
    const planned=spawnSync(process.execPath,['scripts/plan-ci-accounts.mjs','visual'],{
      encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'29',GITHUB_OUTPUT:output,CI_VISUAL_FULL:'true'},
    });
    assert.equal(planned.status,0,planned.stderr);
    const {include}=JSON.parse(readFileSync(output,'utf8').slice('matrix='.length));
    const selected=include[0].account;
    const accounts=ciAccounts.map((username,i)=>({username,password:`FakePassword${i}123`,status:'ready'}));
    const configured=spawnSync(process.execPath,['scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:JSON.stringify({accounts})},
    });
    assert.equal(configured.status,0,configured.stderr);
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
    writeFileSync(environment,'');
    const missing=spawnSync(process.execPath,['scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:''},
    });
    assert.notEqual(missing.status,0);
    assert.equal(readFileSync(environment,'utf8'),'');
  } finally {rmSync(directory,{recursive:true,force:true});}
});
