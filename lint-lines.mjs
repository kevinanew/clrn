import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const limit = 400;
const files = execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
  '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs',
], { cwd: root }).toString().split('\0').filter(Boolean);

const failures = files.flatMap(file => {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) return [];
  const source = readFileSync(fullPath, 'utf8');
  const lines = source === '' ? 0 : source.split('\n').length - Number(source.endsWith('\n'));
  return lines > limit ? [`${file}: ${lines} 行（上限 ${limit} 行）`] : [];
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`行数检查通过：${files.length} 个代码文件均不超过 ${limit} 行`);
}
