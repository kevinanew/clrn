// 检查自动同步的应用分支身份，防止候选部署记录被用于其他分支。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * 验证自动同步记录属于当前测试分支，主干发布后的记录可跨分支使用。
 * @param record - 当前检出提交中的部署记录。
 * @param options - 当前测试分支名。
 */
export function validateTestBranch(record, { branch } = {}) {
  const application = record.application;
  if (!application) return;
  if (application.repository !== 'kevinanew/laiwan_react_native' ||
    typeof application.branch !== 'string' || !application.branch ||
    !Number.isSafeInteger(application.build_number) || application.build_number < 1 ||
    application.channel !== 'branch') {
    throw new Error('应用分支关联信息无效');
  }
  if (application.channel === 'branch' && branch && application.branch !== branch) {
    throw new Error('部署记录与当前测试分支不一致');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateTestBranch(JSON.parse(readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8')),
    { branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME });
}
