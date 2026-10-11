import { spawnSync } from 'node:child_process';
import { repository, sourceFiles } from './source-files.mjs';

// 统一运行全仓库 Node 单元测试；.spec.ts 线上浏览器案例仍由各自 Playwright 入口执行。
const files = sourceFiles().filter(file => /\.test\.(?:mjs|cjs|js|ts|mts|cts)$/.test(file));
if (files.length === 0) throw new Error('未发现本机单元测试，拒绝空跑。');
console.log(`运行 ${files.length} 个本机单元测试文件。`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files],
  { cwd: repository, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
