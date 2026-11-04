import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import tseslint from 'typescript-eslint';
import { repository, sourceFiles } from './source-files.mjs';

/** 从 AST 中读取真实文档块，字符串和正则中的注释标记不参与转换。
 * @param source - 完整 JS/TS 源码。
 * @param file - 源码路径，用于区分 TS 泛型和 JSX。
 * @returns 已解析的 TSDoc 注释。 */
function blocks(source, file) {
  return tseslint.parser.parseForESLint(source, { filePath: file, comment: true, range: true }).ast.comments
    .filter(/** 仅转换文档块，保留普通注释参与既有重复检查。
     * @param comment - 当前语法注释。 */ comment => comment.type === 'Block' && comment.value.startsWith('*'));
}

/** 将换行、星号排版归一，匹配原有说明正文和标签。
 * @param value - 文档块内容。
 * @returns 不受紧凑排版影响的匹配键。 */
function documentKey(value) {
  return value.replace(/^\s*\* ?/gm, '').replace(/\s+/g, ' ').trim();
}

/** 对代码词元与普通注释取精确序列，忽略排版及 TSDoc，保留字面量中的空白。
 * @param source - 完整源码。
 * @param file - 用于选择正确语法的源码路径。
 * @returns 可证明仅文档和排版发生变化的序列。 */
function codeKey(source, file) {
  const ast = tseslint.parser.parseForESLint(source, { filePath: file, comment: true, tokens: true, range: true }).ast;
  const ordinary = ast.comments.filter(/** 保留所有非 TSDoc 注释，禁止借投影隐藏普通注释变化。
   * @param comment - 当前语法注释。 */ comment => comment.type !== 'Block' || !comment.value.startsWith('*'));
  return JSON.stringify([...ast.tokens, ...ordinary].sort(/** 按源码顺序组合代码词元和普通注释。
   * @param left - 左侧词元。
   * @param right - 右侧词元。 */ (left, right) => left.range[0] - right.range[0])
    .map(/** 保留词元类型和未经转换的字面量内容。
     * @param token - 当前代码词元。 */ token => [token.type, source.slice(...token.range)]));
}

/** 保留基线已有文档的原始内容，只移除新增 TSDoc，所有代码 token 均原样保留。
 * @param source - 当前源码。
 * @param reference - 固定重复基线提交的源码。
 * @param file - 当前源码路径。
 * @returns 只供 jscpd 使用的临时扫描文本。 */
export function projectJavascript(source, reference, file) {
  if (codeKey(source, file) === codeKey(reference, file)) return reference;
  const known = new Map(blocks(reference, file).map(/** 按文档正文保存基线原始注释。
   * @param block - 基线文档块。 */ block => [documentKey(block.value), reference.slice(...block.range)]));
  for (const block of blocks(source, file).reverse()) {
    const replacement = known.get(documentKey(block.value)) ?? '';
    const end = block.range[1] + Number(!replacement && source[block.range[1]] === ' ');
    source = source.slice(0, block.range[0]) + replacement + source.slice(end);
  }
  return source;
}

/** 在临时目录写入覆盖全部手写代码的文档投影，保持原生重复基线与阈值不变。
 * @param directory - 专用于本次扫描的临时源码目录。
 * @returns 原始源码文件数。 */
export function writeDuplicationSources(directory) {
  const ref = execFileSync('git', ['log', '-1', '--format=%H', '--', 'quality/jscpd-baseline.json'],
    { cwd: repository, encoding: 'utf8' }).trim();
  if (!ref) throw new Error('无法定位固定重复基线的源码提交。');
  const tracked = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: repository, encoding: 'utf8' }).split('\n'));
  const files = sourceFiles().filter(/** 选择原重复门禁覆盖的全部 JS、TS 与 Python 实现。
   * @param file - 手写源码候选。 */ file => /\.[cm]?[jt]sx?$|\.py$/.test(file));
  if (!files.length) throw new Error('重复检查的源码投影为空。');
  const python = {};
  for (const file of files) {
    const source = readFileSync(join(repository, file), 'utf8');
    const reference = tracked.has(file)
      ? execFileSync('git', ['show', `${ref}:${file}`], { cwd: repository, encoding: 'utf8' }) : '';
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    if (file.endsWith('.py')) python[file] = { source, reference };
    else writeFileSync(join(directory, file), projectJavascript(source, reference, file));
  }
  const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12', 'python', 'scripts/documentation-projection.py'],
    { cwd: repository, input: JSON.stringify(python), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`重复检查文档投影失败：${result.stderr}`);
  const projected = JSON.parse(result.stdout);
  if (Object.keys(projected).length !== Object.keys(python).length) throw new Error('Python 文档投影数量不一致。');
  for (const [file, source] of Object.entries(projected)) writeFileSync(join(directory, file), source);
  return files.length;
}
