import { ESLint } from 'eslint';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';
import { e2eSupportFiles, e2eSupportPatterns, e2eCheckPatterns } from './e2e-complexity-scope.mjs';

/**
 * 校验显式清单后扫描整个案例目录，防止新提取的实现漏出门禁。
 * @returns ESLint 扫描路径和模式。
 */
export function e2eComplexityFiles() {
  const available = new Set(sourceFiles());
  for (const file of e2eSupportFiles) {
    if (!available.has(file)) throw new Error(`E2E 复杂度检查缺少文件：${file}`);
  }
  return [...e2eSupportPatterns, ...e2eCheckPatterns, 'eslint.config.mjs'];
}

/**
 * 使用仓库配置并禁止行内指令；报告模式用原生 max=0 逐函数计数。
 * @param report - 是否测量所有函数。
 * @returns 配置好的 ESLint 实例。
 */
function engine(report) {
  const rules = report ? { complexity: ['error', { max: 0, variant: 'classic' }] } : {};
  return new ESLint({ cwd: repository, overrideConfig: { linterOptions: { noInlineConfig: true }, rules } });
}

/**
 * 保留复杂度、解析与禁用指令错误；历史清单不能豁免本门禁。
 * @param message - ESLint 的原生消息。
 * @returns 是否阻断检查。
 */
function gateMessage(message) {
  return message.fatal || message.severity === 2 && ['complexity', 'quality/no-quality-disable', null].includes(message.ruleId);
}

/**
 * 对临时正负例使用真实路径预算，包含解析错误。
 * @param source - 临时源码。
 * @param filePath - 预算对应的仓库路径。
 * @returns 需要阻断的原生消息。
 */
export async function checkE2eComplexityText(source, filePath) {
  const [result] = await engine(false).lintText(source, { filePath });
  return result.messages.filter(gateMessage);
}

/**
 * 检查指定范围，或输出原生逐函数测量；解析失败绝不产生成功报告。
 * @param report - 是否输出逐函数测量。
 * @param files - 实际文件或扫描模式。
 * @returns 门禁消息或逐函数复杂度。
 */
export async function checkE2eComplexity(report = false, files = e2eComplexityFiles()) {
  const results = await engine(report).lintFiles(files);
  return results.flatMap(/** 转换一个文件的原生消息。
   * @param result - ESLint 文件结果。 */ result => {
    if (result.fatalErrorCount) throw new Error(`E2E 复杂度解析失败：${result.filePath}`);
    const file = relative(repository, result.filePath);
    const messages = result.messages.filter(gateMessage);
    if (!report) return messages.map(/** 保留定位和原生消息。
     * @param message - 原生消息。 */ message => ({ file, ...message }));
    return messages.filter(/** 测量只接受原生复杂度消息。
     * @param message - 原生消息。 */ message => message.ruleId === 'complexity').map(/** 提取原生计数。
     * @param message - 原生复杂度诊断。 */ message => ({ file, line: message.line, column: message.column,
      name: message.message.split(' has a complexity')[0], complexity: Number(message.message.match(/complexity of (\d+)/)[1]) }));
  });
}

/** 执行门禁；超限、依赖缺失、文件缺失或解析失败均返回非零状态。 */
async function main() {
  const report = process.argv.includes('--report');
  const results = await checkE2eComplexity(report);
  if (report) return console.log(JSON.stringify(results, null, 2));
  for (const item of results) console.error(`${item.file}:${item.line}:${item.column} ${item.message}`);
  console.log(`E2E 复杂度：${results.length} 个违规（用例/辅助/配置 ≤3，独立检查工具/根配置 ≤6）。`);
  if (results.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
