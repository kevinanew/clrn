import { appendFileSync } from 'node:fs';
import { ciAccountCredentials } from './ci-accounts.mjs';

// concurrency 在 job 开始前生效；这里仅注入已被该 job 独占账号的凭据。
if (!process.env.GITHUB_ENV || process.env.GITHUB_ACTIONS !== 'true') throw new Error('CI 凭据注入只能在 GitHub Actions 内执行。');
const { username, password } = ciAccountCredentials(process.env.CLRN_CI_TEST_ACCOUNTS, process.env.CLRN_CI_ACCOUNT);
// Mask 命令需要转义工作流控制字符，即使未来密码包含特殊字符也不能注入日志命令。
console.log(`::add-mask::${password.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
const values = { E2E_TEST_USERNAME: username, E2E_TEST_PASSWORD: password,
  E2E_CREATION_USERNAME: username, E2E_CREATION_PASSWORD: password,
  VISUAL_USERNAME: username, VISUAL_PASSWORD: password };
appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key,value]) => `${key}=${value}\n`).join(''));
console.log(`本任务独占 CI 账号：${username}`);
