import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 列出已跟踪和未忽略的新文件，排除被删除的文件与依赖、报告等生成目录。
 * @returns 相对于仓库根目录的源码候选路径。
 */
export function sourceFiles() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
  return [...new Set(paths)].filter(file =>
    !/(?:^|\/)(?:node_modules|\.venv|test-results|playwright-report|blob-report|snapshots|\.ttyctl)(?:\/|$)/.test(file)
    && existsSync(join(repository, file))).sort();
}
