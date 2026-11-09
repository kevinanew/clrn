import { ESLint } from 'eslint';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';
import { toolScopeFiles, scopedToolFiles } from './tool-complexity-scope.mjs';

/** 校验原始文件存在，并纳入相邻测试和新提取的辅助实现。
 * @returns 本范围实际源码路径。 */
export function toolComplexityFiles() {
  const files = sourceFiles();
  for (const file of toolScopeFiles) {
    if (!files.includes(file)) throw new Error(`工具复杂度检查缺少文件：${file}`);
  }
  return scopedToolFiles(files);
}

/** 复用真实 ESLint 配置；报告以原生 max=0 测量全部函数。
 * @param report - 是否测量逐函数计数。
 * @returns 禁止行内配置的检查器。 */
function engine(report) {
  const rules = report ? { complexity: ['error', { max: 0, variant: 'classic' }] } : {};
  return new ESLint({ cwd: repository, overrideConfig: { linterOptions: { noInlineConfig: true }, rules } });
}

/** 保留解析错误与不可豁免的门禁诊断。
 * @param message - ESLint 原生诊断。
 * @returns 是否阻断检查。 */
function gateMessage(message) {
  if (message.fatal) return true;
  return message.severity === 2 && ['complexity', 'quality/no-quality-disable', null].includes(message.ruleId);
}

/** 将临时负例交给真实配置，覆盖默认参数、可选链及嵌套回调。
 * @param source - 临时源码。
 * @param filePath - 适用预算的仓库路径。
 * @returns 需要阻断的诊断。 */
export async function checkToolComplexityText(source, filePath) {
  const [result] = await engine(false).lintText(source, { filePath });
  return result.messages.filter(gateMessage);
}

/** 转换逐函数原生诊断，解析失败不可产生成功报告。
 * @param result - 单文件原生结果。
 * @returns 逐函数定位与计数。 */
function measurements(result) {
  if (result.fatalErrorCount) throw new Error(`工具复杂度解析失败：${result.filePath}`);
  return result.messages.filter(/** 保留原生复杂度消息。
   * @param message - 原生诊断。 */ message => message.ruleId === 'complexity').map(
    /** 直接读取 ESLint classic 计数。
     * @param message - 原生复杂度诊断。 */ message => ({ file: relative(repository, result.filePath),
      line: message.line, column: message.column, name: message.message.split(' has a complexity')[0],
      complexity: Number(message.message.match(/complexity of (\d+)/)[1]) }));
}

/** 独立扫描本范围，历史清单不能豁免超限。
 * @param report - 是否返回逐函数测量。
 * @param files - 本范围实际路径。
 * @returns 测量或门禁诊断。 */
export async function checkToolComplexity(report = false, files = toolComplexityFiles()) {
  const results = await engine(report).lintFiles(files);
  if (report) return results.flatMap(measurements);
  return results.flatMap(/** 保留文件定位和原生诊断。
   * @param result - 单文件结果。 */ result => result.messages.filter(gateMessage).map(
    /** 为诊断补充仓库相对路径。
     * @param message - 原生诊断。 */ message => ({ file: relative(repository, result.filePath), ...message })));
}

/** 执行门禁或报告；缺依赖、缺文件及解析异常自然以非零退出。 */
async function main() {
  const report = process.argv.includes('--report');
  const results = await checkToolComplexity(report);
  if (report) return console.log(JSON.stringify(results, null, 2));
  for (const item of results) console.error(`${item.file}:${item.line}:${item.column} ${item.message}`);
  console.log(`工具复杂度：${results.length} 个违规（测试及辅助 ≤3，独立工具及根配置 ≤6）。`);
  if (results.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
