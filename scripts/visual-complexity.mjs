import { ESLint } from 'eslint';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';
import { visualSupportFiles, visualToolFiles } from './visual-complexity-scope.mjs';

/**
 * 按显式范围列出本任务文件及检查实现，遗漏或删除源码时拒绝空跑。
 * @returns 本任务实际扫描的源码路径。
 */
export function visualComplexityFiles() {
  const files = sourceFiles();
  const required = [...visualSupportFiles, ...visualToolFiles, 'eslint.config.mjs'];
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`视觉复杂度检查缺少文件：${file}`);
  }
  return [...new Set([...required, ...files.filter(file => /^scripts\/visual-complexity.*\.mjs$/.test(file))])];
}

/**
 * 使用现有 ESLint 配置独立检查复杂度及禁止禁用注释，绝不读取历史豁免。
 * @param files - 需要扫描的实际文件。
 * @returns 逐文件 ESLint 结果。
 */
export async function checkVisualComplexity(files = visualComplexityFiles()) {
  const results = await new ESLint({ cwd: repository, overrideConfig: { linterOptions: { noInlineConfig: true } } }).lintFiles(files);
  return results.map(result => ({ ...result, messages: result.messages.filter(isGateMessage) }));
}

/**
 * 将同一门禁应用于临时静态正负例，保留解析错误。
 * @param source - 要检查的源码。
 * @param filePath - 预算所属路径。
 * @returns 应阻断门禁的原生诊断。
 */
export async function checkVisualComplexityText(source, filePath) {
  const eslint = new ESLint({ cwd: repository, overrideConfig: { linterOptions: { noInlineConfig: true } } });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(isGateMessage);
}

/**
 * 独立门禁仅关注复杂度、解析失败及绕过质量规则的指令。
 * @param message - ESLint 原生诊断。
 * @returns 是否应阻断本任务门禁。
 */
function isGateMessage(message) {
  if (message.fatal || message.ruleId === null) return true;
  return ['complexity', 'quality/no-quality-disable'].includes(message.ruleId);
}

/**
 * 以 ESLint classic max=0 输出每一个函数，包含匿名、嵌套回调及默认参数。
 * @returns 当前逐函数实测报告。
 */
export async function measureVisualComplexity() {
  const eslint = new ESLint({ cwd: repository, overrideConfig: {
    linterOptions: { noInlineConfig: true }, rules: { complexity: ['error', { max: 0, variant: 'classic' }] },
  } });
  const results = await eslint.lintFiles(visualComplexityFiles());
  return results.flatMap(functionMeasurements);
}

/**
 * 转换原生复杂度诊断，不以自制算法替代 ESLint 计数。
 * @param result - 单文件检查结果。
 * @returns 该文件每个函数的位置与复杂度。
 */
function functionMeasurements(result) {
  if (result.fatalErrorCount) throw new Error(`复杂度测量解析失败：${result.filePath}`);
  return result.messages.filter(message => message.ruleId === 'complexity').map(message => ({
    file: relative(repository, result.filePath), line: message.line, column: message.column,
    name: message.message.split(' has a complexity')[0], complexity: Number(message.message.match(/complexity of (\d+)/)[1]),
  }));
}

/** 执行独立门禁或打印完整测量结果，失败均返回非零状态。 */
async function main() {
  if (process.argv.includes('--report')) {
    console.log(JSON.stringify(await measureVisualComplexity(), null, 2));
    return;
  }
  const results = await checkVisualComplexity();
  const messages = results.flatMap(result => result.messages.map(message =>
    `${relative(repository, result.filePath)}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`));
  for (const message of messages) console.error(message);
  console.log(`视觉复杂度：${results.length} 个文件，${messages.length} 个违规（测试/辅助 ≤3，工具/配置 ≤6）。`);
  if (messages.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
