import { appendFileSync } from 'node:fs';
import { allocateCiAccount, visualAccountMatrix, animationAccountMatrix } from './ci-accounts.mjs';

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
const mode = process.argv[2];
const runId = process.env.GITHUB_RUN_ID;
if (mode === 'animations') {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(animationAccountMatrix(runId, process.env.CI_ANIMATION_SUITE || 'all'))}\n`);
} else if (mode === 'visual') {
  const matrix = visualAccountMatrix(runId, process.env.CI_VISUAL_SUITE || 'all', process.env.CI_VISUAL_FULL === 'true');
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
} else if (['e2e', 'functional', 'interactions'].includes(mode)) {
  // 同一部署入口调用四组工作流时运行 ID 相同，前三组避开视觉的 0–8 号槽位。
  const offset = { e2e: 9, functional: 10, interactions: 11 }[mode];
  appendFileSync(process.env.GITHUB_OUTPUT, `account=${allocateCiAccount(runId, offset)}\n`);
} else {
  throw new Error('账号调度模式必须为 e2e、functional、interactions、visual 或 animations。');
}
