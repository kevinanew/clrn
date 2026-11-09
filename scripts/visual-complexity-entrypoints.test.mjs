import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import { visualEntryFiles, visualSupportFiles, visualToolFiles } from './visual-complexity-scope.mjs';
import { checkVisualComplexityText, visualComplexityFiles } from './visual-complexity.mjs';
import { isolatedVisualRepository, assertVisualGateStatus, runVisualGate } from './visual-complexity-fixture.mjs';

/**
 * 生成由原生 ESLint classic 规则测量的边界函数。
 * @param complexity - 预期复杂度。
 * @returns 临时源码。
 */
function probe(complexity) {
  return `export function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`;
}

const directoryHelperPaths = [
  'visual/scenariosSupport/helpers.ts',
  'visual/scenarios/helpers.ts',
  'visual/tests/walletTransactionReadiness/helpers.ts',
  'visual/scenariosSupport/nested/deeper/helpers.ts',
  'visual/open-reportSupport/nested/helpers.ts',
  'visual/playwright.config/helpers.ts',
];

const helperPaths = [
  'visual/scenariosFutureHelper.ts',
  'visual/scenariosFutureHelper.test.ts',
  'visual/scenarioScopeFutureHelper.ts',
  'visual/run-visual-support.ts',
  'visual/tests/walletTransactionReadinessFixture.ts',
  'visual/open-report.test.ts',
  'visual/playwright.config.test.ts',
  'scripts/visual-complexity-fixture.mjs',
  'visual/scenariosFutureHelper.js',
  'visual/scenariosFutureHelper.mts',
  'visual/scenariosFutureHelper.cts',
  ...directoryHelperPaths,
];

const unrelatedPaths = ['visual/animations/timeline.ts', 'visual/src/support/preparePage.ts', 'visual/cases/auth/scenarios.ts'];

/**
 * 为每个模块生成同名及同名前缀目录中各类源码扩展名的后代路径。
 * @param file - 原始模块或相邻测试路径。
 * @returns 应当全部沿用辅助预算的候选路径。
 */
function descendantPaths(file) {
  const stem = file.replace(/(?:\.(?:test|spec|browser))?\.ts$/, '');
  return ['', 'Support'].flatMap(/** 同名目录与前缀目录都覆盖多层后代。
   * @param suffix - 模块目录后缀。 */ suffix => ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].map(/** 各扩展名沿用同一预算。
    * @param extension - ESLint 支持的源码扩展名。 */ extension => `${stem}${suffix}/nested/helpers.${extension}`));
}

for (const file of helperPaths) {
  test(`${file} 新提取实现及相邻测试沿用 3/4 边界`, /** 使用与正式门禁相同的路径和配置。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    assert.ok((await checkVisualComplexityText(probe(4), file)).some(/** 要求原生复杂度超限诊断。
     * @param message - ESLint 消息。 */ message => message.ruleId === 'complexity'));
  });
}

test('视觉入口范围包含原清单及同名前缀辅助模块，排除其他目录', /** 检查文件发现与预算使用同一范围。 */ () => {
  const entries = [...visualSupportFiles, ...visualToolFiles, ...helperPaths.filter(/** 检查脚本不属于视觉模块目录。
   * @param file - 静态探针路径。 */ file => file.startsWith('visual/'))];
  assert.deepEqual(visualEntryFiles([...entries, ...unrelatedPaths]), entries);
  assert.deepEqual(visualEntryFiles(visualComplexityFiles(false, true)), visualEntryFiles(visualComplexityFiles()));
  assert.equal(visualComplexityFiles(false, true).includes('visual/animations/timeline.ts'), false);
});

test('CLI 发现的全部辅助文件及各模块后代均使用 classic 上限 3，显式工具仍为 6', /** 逐文件核对实际 ESLint override 而非推断 glob 行为。 */ async () => {
  const eslint = new ESLint();
  const descendants = [...new Set([...visualSupportFiles, ...visualToolFiles].flatMap(descendantPaths))];
  assert.deepEqual(visualEntryFiles(descendants), descendants);
  const support = visualEntryFiles([...visualComplexityFiles(false, true), ...helperPaths, ...descendants]).filter(/** 仅显式列出的工具可放宽预算。
   * @param file - CLI 纳入的模块路径。 */ file => !visualToolFiles.includes(file));
  for (const [max, files] of [[3, [...support, unrelatedPaths[2]]], [6, visualToolFiles], [10, [unrelatedPaths[1]]]]) {
    for (const file of files) {
      const config = await eslint.calculateConfigForFile(file);
      assert.deepEqual(config.rules.complexity, [2, { max, variant: 'classic' }], file);
    }
  }
});

for (const modes of [['--entrypoints'], []]) {
  for (const file of directoryHelperPaths) {
    test(`npm ${modes.join(' ') || '默认入口'} 目录辅助模块 ${file} 的 3 通过、4 失败`, /** 两个正式入口都必须因当前文件的复杂度诊断失败。 */ () => {
      const directory = isolatedVisualRepository();
      try {
        const target = path.join(directory, file);
        assertVisualGateStatus(directory, target, probe(3), 0, ...modes);
        const result = assertVisualGateStatus(directory, target, probe(4), 1, ...modes);
        assert.ok(result.stderr.includes(`${file}:`), result.stderr);
        assert.match(result.stderr, /complexity: .*Maximum allowed is 3/);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

const cliProbes = [
  ['visual/scenarios.test.ts', probe(3), 0],
  ['visual/scenarios.test.ts', probe(4), 1],
  ['visual/scenariosFutureHelper.ts', probe(3), 0],
  ['visual/scenariosFutureHelper.ts', probe(4), 1],
  ['visual/scenariosFutureHelper.ts', `export function outer() { return () => { ${'if (x) x++;'.repeat(3)} }; }`, 1],
  ['visual/scenariosFutureHelper.ts', `/* eslint-disable */\n${probe(4)}`, 1],
  ['visual/scenariosFutureHelper.ts', 'export function (', 1],
  ['visual/open-report.ts', probe(6), 0],
  ['visual/open-report.ts', probe(7), 1],
];

test('npm 定向入口实际阻断测试、提取模块、工具、嵌套回调、禁用注释及解析失败', /** 在隔离目录验证真实进程退出码。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    for (const [file, source, expected] of cliProbes) {
      assertVisualGateStatus(directory, path.join(directory, file), source, expected, '--entrypoints');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('视觉入口独立验收不依赖动画目录，默认入口仍阻断动画超限', /** 同一负例验证范围隔离与原入口覆盖。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    const file = path.join(directory, 'visual/animations/timelineFutureHelper.ts');
    writeFileSync(file, probe(4));
    const entries = runVisualGate(directory, '--entrypoints');
    assert.equal(entries.status, 0, entries.stdout + entries.stderr);
    const result = runVisualGate(directory, '--animations');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const combined = runVisualGate(directory);
    assert.equal(combined.status, 1, combined.stdout + combined.stderr);
    assert.match(combined.stderr, /timelineFutureHelper.ts/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('视觉入口所需原文件缺失时非零退出', /** 防止删除源码后出现成功空跑。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    rmSync(path.join(directory, 'visual/scenarios.ts'));
    const result = runVisualGate(directory, '--entrypoints');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /视觉复杂度检查缺少文件：visual\/scenarios.ts/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('解析失败不能输出成功测量报告', /** 报告入口与门禁入口都保留解析错误。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    writeFileSync(path.join(directory, 'visual/scenariosFutureHelper.ts'), 'export function (');
    const result = runVisualGate(directory, '--report');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /复杂度测量解析失败/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
