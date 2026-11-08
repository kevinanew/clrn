import { ESLint } from 'eslint';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';
import { visualSupportFiles, visualToolFiles, animationSupportFiles, animationFiles } from './visual-complexity-scope.mjs';

/**
 * 按显式范围列出本任务文件及检查实现，遗漏或删除源码时拒绝空跑。
 * @param animationsOnly - 是否只扫描动画范围与门禁实现。
 * @returns 本任务实际扫描的源码路径。
 */
export function visualComplexityFiles(animationsOnly = false) {
  const files = sourceFiles();
  const required = [...animationSupportFiles, ...existingVisualFiles(animationsOnly), 'eslint.config.mjs'];
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`视觉复杂度检查缺少文件：${file}`);
  }
  return [...new Set([...required, ...animationFiles(files), ...files.filter(/** 根据当前条目计算结果。
 * @param file - 当前回调参数。 */ file => /^scripts\/visual-complexity.*\.mjs$/.test(file))])];
}

/**
 * 使用现有 ESLint 配置独立检查复杂度及禁止禁用注释，绝不读取历史豁免。
 * @param files - 需要扫描的实际文件。
 * @returns 逐文件 ESLint 结果。
 */
export async function checkVisualComplexity(files = visualComplexityFiles()) {
  const results = await new ESLint({ cwd: repository, overrideConfig: { linterOptions: { noInlineConfig: true } } }).lintFiles(files);
  return results.map(/** 根据当前条目计算结果。
 * @param result - 当前回调参数。 */ result => ({ ...result, messages: result.messages.filter(isGateMessage) }));
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
 * @param files - 要测量的实际文件。
 * @returns 当前逐函数实测报告。
 */
export async function measureVisualComplexity(files = visualComplexityFiles()) {
  const eslint = new ESLint({ cwd: repository, overrideConfig: {
    linterOptions: { noInlineConfig: true }, rules: { complexity: ['error', { max: 0, variant: 'classic' }] },
  } });
  const results = await eslint.lintFiles(files);
  return results.flatMap(functionMeasurements);
}

/**
 * 转换原生复杂度诊断，不以自制算法替代 ESLint 计数。
 * @param result - 单文件检查结果。
 * @returns 该文件每个函数的位置与复杂度。
 */
function functionMeasurements(result) {
  if (result.fatalErrorCount) throw new Error(`复杂度测量解析失败：${result.filePath}`);
  return result.messages.filter(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message => message.ruleId === 'complexity').map(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message => ({
    file: relative(repository, result.filePath), line: message.line, column: message.column,
    name: message.message.split(' has a complexity')[0], complexity: Number(message.message.match(/complexity of (\d+)/)[1]),
  }));
}

/** 执行独立门禁或打印完整测量结果，失败均返回非零状态。 */
async function main() {
  const files = visualComplexityFiles(process.argv.includes('--animations'));
  if (process.argv.includes('--report')) {
    console.log(JSON.stringify(await measureVisualComplexity(files), null, 2));
    return;
  }
  const results = await checkVisualComplexity(files);
  const messages = results.flatMap(/** 根据当前条目计算结果。
 * @param result - 当前回调参数。 */ result => result.messages.map(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message =>
    `${relative(repository, result.filePath)}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`));
  for (const message of messages) console.error(message);
  console.log(`视觉复杂度：${results.length} 个文件，${messages.length} 个违规（测试/辅助 ≤3，工具/配置 ≤6）。`);
  if (messages.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

/**
 * 动画定向入口独立于其他目录，普通入口仍保持既有全部范围。
 * @param animationsOnly - 是否只运行动画范围。
 * @returns 其他视觉模块的必要路径。
 */
function existingVisualFiles(animationsOnly) { return animationsOnly ? [] : [...visualSupportFiles, ...visualToolFiles]; }
