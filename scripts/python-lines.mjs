import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repository, sourceFiles } from './source-files.mjs';

export const pythonLineLimit = 500;

/**
 * 统计物理行，保留空行、注释及 docstring；支持 LF、CRLF、CR 和缺少末尾换行。
 *
 * @param source - 完整源码文本。
 * @returns 空文件为零，其余为实际物理行数。
 */
export function physicalLines(source) {
  return source === '' ? 0 : source.split(/\r\n|\r|\n/).length - Number(/[\r\n]$/.test(source));
}

/**
 * 只读扫描 Python 手写源码；Git、读取异常和空扫描必须失败。
 *
 * @param directory - Git 仓库根目录。
 * @returns 实际扫描文件数、最长文件和全部超限位置。
 */
export function scanPythonLines(directory = repository) {
  const measured = [];
  for (const file of sourceFiles(directory).filter(/** 筛选 Python 源文件。
 * @param file - 候选路径。 */ file => file.endsWith('.py'))) {
    try {
      measured.push({ file, lines: physicalLines(readFileSync(join(directory, file), 'utf8')) });
    } catch (error) {
      if (error.code !== 'ENOENT' || lstatSync(join(directory, file), { throwIfNoEntry: false })) throw error;
      // Git 列举后被删除的文件也正常跳过，其余读取错误不能吞掉。
    }
  }
  if (!measured.length) throw new Error('Python 行数检查没有扫描到源码。');
  const longest = measured.reduce(/** 保留行数最多的文件。
 * @param maximum - 当前最大值。
 * @param item - 当前文件。 */ (maximum, item) => item.lines > maximum.lines ? item : maximum);
  return { count: measured.length, longest, violations: measured.filter(/** 筛选超出行数限制的文件。
 * @param item - 当前文件。 */ item => item.lines > pythonLineLimit) };
}

/** 打印真实测量及全部超限诊断，异常和超限均非零退出。 */
function main() {
  try {
    const { count, longest, violations } = scanPythonLines();
    console.log(`Python 行数检查：扫描 ${count} 个文件；最长 ${longest.file}: ${longest.lines} 行（上限 ${pythonLineLimit} 行）`);
    for (const { file, lines } of violations) console.error(`${file}: ${lines} 行（上限 ${pythonLineLimit} 行）`);
    if (violations.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Python 行数检查失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
