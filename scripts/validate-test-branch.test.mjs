// 验证同名分支身份、主干构建提升和传统部署记录的兼容行为。
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTestBranch } from './validate-test-branch.mjs';

test('候选包固定同名分支，主干构建提升后可用于 master', /** 检查分支身份和主干构建的兼容行为。 */ () => {
  const record = { application: { repository: 'kevinanew/laiwan_react_native',
    branch: '功能/大厅', build_number: 123, channel: 'branch' } };
  assert.doesNotThrow(/** 同名分支允许测试。 */ () => validateTestBranch(record, { branch: '功能/大厅' }));
  assert.throws(/** 错误分支不能使用候选包。 */ () => validateTestBranch(record, { branch: 'master' }), /不一致/);
  record.application.channel = 'staging';
  assert.throws(/** 拒绝已废弃的状态标记。 */ () => validateTestBranch(record, { branch: 'master' }), /无效/);
  assert.doesNotThrow(/** 提升后复制主干记录，不保留分支字段。 */ () => validateTestBranch({}, { branch: 'master' }));
  record.application.repository = 'another/repository';
  assert.throws(/** 不接受其他应用的身份。 */ () => validateTestBranch(record), /无效/);
});
