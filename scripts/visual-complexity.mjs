import { captureSupportFiles, captureFiles } from './visual-complexity-capture-scope.mjs';
import { ESLint } from 'eslint';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';
import { visualSupportFiles, visualToolFiles, visualEntryFiles, animationSupportFiles, animationFiles, browserSupportFiles, browserFiles } from './visual-complexity-scope.mjs';

/**
 * 按显式范围列出本任务文件及检查实现，遗漏或删除源码时拒绝空跑。
 * @param animationsOnly - 是否只扫描动画范围与门禁实现。
 * @param entrypointsOnly - 是否只扫描视觉入口范围与门禁实现。
 * @param browserOnly - 是否只扫描页面与浏览器支持范围。
 * @returns 本任务实际扫描的源码路径。
 */
export function visualComplexityFiles(animationsOnly = false, entrypointsOnly = false, browserOnly = false) {
  const files = sourceFiles();
  const required = [...existingAnimationFiles(entrypointsOnly, browserOnly), ...existingVisualFiles(animationsOnly, browserOnly), ...existingBrowserFiles(animationsOnly, entrypointsOnly), 'eslint.config.mjs'];
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`视觉复杂度检查缺少文件：${file}`);
  }
  return [...new Set([...required, ...scopedSupportFiles(files, animationsOnly, entrypointsOnly, browserOnly), ...defaultCaptureFiles(animationsOnly, entrypointsOnly, browserOnly), ...files.filter(/** 根据当前条目计算结果。
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
  const files = commandFiles(process.argv);
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
 * @param browserOnly - 是否只扫描页面支持。
 * @returns 其他视觉模块的必要路径。
 */
function existingVisualFiles(animationsOnly, browserOnly) { return animationsOnly || browserOnly ? [] : [...visualSupportFiles, ...visualToolFiles]; }

/**
 * 入口定向检查不依赖动画目录先清零。
 * @param entrypointsOnly - 是否只扫描视觉入口。
 * @param browserOnly - 是否只扫描页面支持。
 * @returns 动画范围的必要路径。
 */
function existingAnimationFiles(entrypointsOnly, browserOnly) { return entrypointsOnly || browserOnly ? [] : animationSupportFiles; }

/**
 * 默认入口保持全部视觉范围，各定向入口只扫描自己的辅助模块。
 * @param files - 当前源码路径。
 * @param animationsOnly - 是否只扫描动画。
 * @param entrypointsOnly - 是否只扫描视觉入口。
 * @param browserOnly - 是否只扫描页面支持。
 * @returns 对应范围内原模块和新提取模块。
 */
function scopedSupportFiles(files, animationsOnly, entrypointsOnly, browserOnly) {
  const entries = animationsOnly || browserOnly ? [] : visualEntryFiles(files);
  const animations = entrypointsOnly || browserOnly ? [] : animationFiles(files);
  return [...entries, ...animations, ...scopedBrowserFiles(files, animationsOnly, entrypointsOnly)];
}

/** 其他定向入口不依赖页面支持范围先清零。
 * @param animationsOnly - 是否仅扫描动画。
 * @param entrypointsOnly - 是否仅扫描视觉入口。
 * @returns 页面支持原始必需文件。 */
function existingBrowserFiles(animationsOnly, entrypointsOnly) { return animationsOnly || entrypointsOnly ? [] : browserSupportFiles; }

/** 发现页面支持新增模块，使用与 ESLint override 相同的范围。
 * @param files - 源码候选。
 * @param animationsOnly - 是否仅扫描动画。
 * @param entrypointsOnly - 是否仅扫描视觉入口。
 * @returns 页面支持实际文件。 */
function scopedBrowserFiles(files, animationsOnly, entrypointsOnly) { return animationsOnly || entrypointsOnly ? [] : browserFiles(files); }

/** 定向模式互斥，默认入口仍覆盖全部已接入范围。
 * @param args - 命令行参数。
 * @returns 正式入口需要检查的文件。 */
function commandFiles(args) {
  const modes = ['--animations', '--entrypoints', '--browser-support', '--capture'];
  const selected = modes.filter(/** 按显式模式选择范围。
   * @param mode - 定向参数。 */ mode => args.includes(mode));
  if (selected.length > 1) throw new Error('复杂度定向模式不能与其他定向参数同时使用');
  if (args.includes('--capture')) return captureComplexityFiles();
  return visualComplexityFiles(...modes.slice(0, 3).map(/** 保留已有 API 的参数顺序。
   * @param mode - 定向参数。 */ mode => args.includes(mode)));
}

/** 扫描采集范围及共享门禁。
 * @returns 采集范围文件。 */
export function captureComplexityFiles() {
  const files = sourceFiles();
  for (const file of captureSupportFiles) {
    if (!files.includes(file)) throw new Error(`动画采集复杂度检查缺少文件：${file}`);
  }
  return [...new Set([...captureFiles(files), 'eslint.config.mjs', ...files.filter(isVisualCheckFile)])];
}

/** 默认检查包含采集范围。
 * @param animationsOnly - 动画范围。
 * @param entrypointsOnly - 入口范围。
 * @param browserOnly - 页面支持范围。
 * @returns 采集文件。 */
function defaultCaptureFiles(animationsOnly, entrypointsOnly, browserOnly) {
  if (animationsOnly || entrypointsOnly || browserOnly) return [];
  return captureComplexityFiles();
}

/** 判断共享视觉门禁文件。
 * @param file - 文件路径。
 * @returns 是否为门禁文件。 */
function isVisualCheckFile(file) { return /^scripts\/visual-complexity.*\.mjs$/.test(file); }
