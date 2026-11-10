import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import { browserSupportFiles, browserFiles } from './visual-complexity-scope.mjs';
import { checkVisualComplexityText, visualComplexityFiles } from './visual-complexity.mjs';
import { isolatedVisualRepository, assertVisualGateStatus, runVisualGate } from './visual-complexity-fixture.mjs';

/** 生成精确 classic 复杂度的临时函数。
 * @param complexity - 原生规则应测得的复杂度。
 * @returns 临时源码。 */
function probe(complexity) {
  return `function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`;
}

/** 对每个模块生成相邻测试及前缀目录内的各类源码路径。
 * @param file - 必须存在的原始模块。
 * @returns 应沿用辅助预算的路径。 */
function descendants(file) {
  const stem = file.replace(/(?:\.test)?\.ts$/, '');
  return ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].flatMap(/** 逐扩展名覆盖相邻模块及多层目录。
   * @param extension - 源码扩展名。 */ extension => [
    `${stem}Fixture.${extension}`, `${stem}.test.${extension}`,
    `${stem}/nested/helper.${extension}`, `${stem}Support/nested/helper.${extension}`,
  ]);
}

const helperPaths = [...new Set(browserSupportFiles.flatMap(descendants))];
const modes = ['--browser-support'];

for (const file of [...browserSupportFiles, ...helperPaths]) {
  test(`${file} 使用测试辅助 classic 3/4 边界`, /** 原文件、匿名回调及提取模块均不可按工具放宽。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    const errors = await checkVisualComplexityText(probe(4), file);
    assert.ok(errors.some(/** 要求真实原生复杂度诊断。
     * @param error - ESLint 消息。 */ error => error.ruleId === 'complexity'));
  });
}

test('页面支持独立范围覆盖同名前缀后代，ESLint override 与实际发现一致', /** 验证入口范围与预算，不依赖其他目录清零。 */ async () => {
  const files = visualComplexityFiles(false, false, true);
  assert.deepEqual(browserFiles([...browserSupportFiles, ...helperPaths]), [...browserSupportFiles, ...helperPaths]);
  for (const file of browserSupportFiles) assert.ok(files.includes(file), file);
  assert.equal(files.includes('visual/scenarios.ts'), false);
  assert.equal(files.includes('visual/animations/timeline.ts'), false);
  const eslint = new ESLint();
  await assertSupportConfigs(eslint, [...browserFiles(files), ...helperPaths]);
});

/** 所有发现的页面辅助均须由现有配置明确约束为 3。
 * @param eslint - 使用正式配置的检查器。
 * @param files - 所有发现及潜在提取路径。 */
async function assertSupportConfigs(eslint, files) {
  for (const file of files) {
    const config = await eslint.calculateConfigForFile(file);
    assert.deepEqual(config.rules.complexity, [2, { max: 3, variant: 'classic' }], file);
  }
}

const probes = [
  ['visual/src/support/pageSetup.test.ts', probe(3), 0],
  ['visual/src/support/pageSetup.test.ts', probe(4), 1],
  ['visual/src/support/preparePageFixture.ts', probe(3), 0],
  ['visual/src/support/preparePageFixture.ts', probe(4), 1],
  ['visual/src/support/preparePageSupport/nested/helper.mts', probe(3), 0],
  ['visual/src/support/preparePageSupport/nested/helper.mts', probe(4), 1],
  ['visual/src/support/authFlowFixture.ts', 'export function outer() { return () => { if (a) a++; if (b) b++; if (c) c++; }; }', 1],
  ['visual/src/support/authFlowFixture.ts', 'export class Probe { constructor(x = 0) { if (x) x++; if (x) x++; } }', 1],
  ['visual/src/support/authFlowFixture.ts', 'export class Probe { get value() { if (a) a++; if (b) b++; return c ? 1 : 0; } }', 1],
  ['visual/src/support/authFlowFixture.ts', 'export const probe = function(x = 0) { return x?.a?.b; };', 1],
  ['visual/src/support/authFlowFixture.ts', 'export const probe = (x = 0) => x || a && b;', 1],
  ['visual/src/support/authFlowFixture.ts', 'export function (', 1],
  ['scripts/visual-complexity-probe.mjs', probe(6), 0],
  ['scripts/visual-complexity-probe.mjs', probe(7), 1],
];

const executableProbes = [...probes];
for (const directive of ['/* eslint-disable */', '/* eslint-disable complexity, quality/no-quality-disable */', '/* eslint complexity: ["error", 99] */']) {
  executableProbes.push(['visual/src/support/authFlowFixture.ts', `${directive}\n${probe(4)}`, 1]);
}

test('正式 npm 入口阻断边界、嵌套回调、语法分支、禁用注释及解析失败', /** 隔离临时探针，逐一验证真实退出码。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    for (const [file, source, status] of executableProbes) {
      assertVisualGateStatus(directory, path.join(directory, file), source, status, ...modes);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('页面支持与其他定向范围互不依赖，默认门禁仍检查页面辅助', /** 同一探针验证定向隔离及默认 lint 接线。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    const file = path.join(directory, 'visual/src/support/preparePageFixture.ts');
    writeFileSync(file, probe(4));
    const result = runVisualGate(directory);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /preparePageFixture.ts.*Maximum allowed is 3/);
    assert.equal(runVisualGate(directory, '--entrypoints').status, 0);
    assert.equal(runVisualGate(directory, '--animations').status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const file of browserSupportFiles) {
  test(`原始必需文件 ${file} 缺失时拒绝空跑`, /** 删除任何必需文件都必须非零退出。 */ () => {
    const directory = isolatedVisualRepository();
    try {
      rmSync(path.join(directory, file));
      const result = runVisualGate(directory, ...modes);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(result.stderr.includes(`视觉复杂度检查缺少文件：${file}`));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('报告解析失败非零退出，定向参数不可同时使用', /** 测量入口不接受损坏源码或歧义范围。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    writeFileSync(path.join(directory, 'visual/src/support/authFlowFixture.ts'), 'export function (');
    const report = runVisualGate(directory, ...modes, '--report');
    assert.equal(report.status, 1, report.stdout + report.stderr);
    assert.match(report.stderr, /复杂度测量解析失败/);
    const ambiguous = runVisualGate(directory, ...modes, '--entrypoints');
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stderr, /复杂度定向模式不能与其他定向参数同时使用/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('根配置的 classic 工具上限为 6', /** 验证配置本身的 6/7 边界。 */ async () => {
  assert.deepEqual(await checkVisualComplexityText(probe(6), 'eslint.config.mjs'), []);
  assert.ok((await checkVisualComplexityText(probe(7), 'eslint.config.mjs')).length > 0);
  assert.match(readFileSync('package.json', 'utf8'), /lint:visual-complexity/);
});
