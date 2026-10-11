import { appendFileSync } from 'node:fs';
import { allocateCiAccount, visualAccountMatrix } from './ci-accounts.mjs';

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
const mode = process.argv[2];
const runId = process.env.GITHUB_RUN_ID;
if (mode === 'visual') {
  const matrix = visualAccountMatrix(runId, process.env.CI_VISUAL_SUITE || 'all', process.env.CI_VISUAL_FULL === 'true');
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
} else if (['e2e', 'functional', 'interactions'].includes(mode)) {
  appendFileSync(process.env.GITHUB_OUTPUT, `account=${allocateCiAccount(runId)}\n`);
} else {
  throw new Error('账号调度模式必须为 e2e、functional、interactions 或 visual。');
}
