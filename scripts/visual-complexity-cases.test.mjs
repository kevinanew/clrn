/** Issue 104 场景范围的真实 ESLint 边界、接线和失败退出验证。 */
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { sourceFiles } from './source-files.mjs';
import { visualCaseFiles, visualCaseSupportFiles } from './visual-complexity-scope.mjs';
import { checkVisualComplexityText, visualComplexityFiles } from './visual-complexity.mjs';
import { isolatedVisualRepository, assertVisualGateStatus, runVisualGate } from './visual-complexity-fixture.mjs';

/**
 * 通过 classic 独立 if 分支生成指定复杂度。
 * @param complexity - 目标复杂度。
 * @returns 临时源码。
 */
function probe(complexity) { return `export function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`; }

for (const file of visualCaseFiles(sourceFiles())) {
  test(`${file} 适用测试辅助预算 3/4`, /** 每个实际文件均使用相同严格预算。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    assert.ok((await checkVisualComplexityText(probe(4), file)).some(
      /** 必须收到原生 complexity 诊断。
       * @param message - ESLint 消息。 */ message => message.ruleId === 'complexity'));
  });
}

for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
  const file = `visual/cases/_shared/future/nested/helper.${extension}`;
  test(`新模块扩展名不放宽辅助预算：${extension}`, /** 覆盖不同后缀的提取实现。 */ async () => {
    assert.deepEqual(visualCaseFiles([file]), [file]);
    assert.deepEqual(await checkVisualComplexityText(probe(3).replace(/^export /, ''), file), []);
    assert.ok((await checkVisualComplexityText(probe(4).replace(/^export /, ''), file)).some(
      /** 必须收到原生 complexity 诊断。
       * @param message - ESLint 消息。 */ message => message.ruleId === 'complexity'));
  });
}

const bypasses = [
  'export function outer() { return () => { if (a) a++; if (b) b++; if (c) c++; }; }',
  'export class Probe { constructor(x = 0) { if (x) x++; if (x) x++; } }',
  'export class Probe { get value() { if (a) a++; if (b) b++; return c ? 1 : 0; } }',
  'export const helper = function(x = 0) { return x?.a?.b; };',
  'export const helper = (x = 0) => x || a && b;',
  '/* eslint-disable complexity */ ' + probe(4),
  '/* eslint-disable */ ' + probe(4),
  '/* eslint complexity: ["error", 99] */ ' + probe(4),
];
for (const source of bypasses) {
  test(`新增嵌套测试辅助不可绕过门禁：${source}`, /** 覆盖新增目录而非只匹配既有文件后缀。 */ async () => {
    const messages = await checkVisualComplexityText(source, 'visual/cases/texas-holdem/future/helper.ts');
    assert.ok(messages.some(/** 保留每个函数的原生计数。
     * @param message - ESLint 消息。 */ message => message.ruleId === 'complexity'));
  });
}

test('场景定向入口完整覆盖原文件、相邻测试和新模块，独立于其他视觉目录', /** 核对实际扫描范围。 */ () => {
  const files = visualComplexityFiles(false, false, true);
  for (const file of visualCaseSupportFiles) assert.ok(files.includes(file));
  assert.deepEqual(visualCaseFiles(files).sort(), visualCaseFiles(sourceFiles()).sort());
  assert.equal(files.includes('visual/scenarios.ts'), false);
  assert.equal(files.includes('visual/animations/timeline.ts'), false);
  assert.ok(files.includes('eslint.config.mjs'));
});

const probes = [
  ['visual/cases/_shared/room.test.ts', probe(3), 0],
  ['visual/cases/_shared/room.test.ts', probe(4), 1],
  ['visual/cases/texas-holdem/future/helper.ts', probe(3), 0],
  ['visual/cases/texas-holdem/future/helper.ts', probe(4), 1],
  ['visual/cases/texas-holdem/future/helper.ts', bypasses[0], 1],
  ['visual/cases/texas-holdem/future/helper.ts', '/* eslint-disable */\n' + probe(4), 1],
  ['visual/cases/texas-holdem/future/helper.ts', 'export function (', 1],
  ['scripts/visual-complexity-probe.mjs', probe(6), 0],
  ['scripts/visual-complexity-probe.mjs', probe(7), 1],
];

test('正式 npm 场景入口执行 3/4、6/7、嵌套、禁用注释与解析失败边界', /** 对真实进程退出码执行断言。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    for (const [file, source, expected] of probes) {
      assertVisualGateStatus(directory, path.join(directory, file), source, expected, '--cases');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('默认入口阻断场景超限，定向入口不要求其他视觉范围先清零', /** 验证现有 lint 调用链与范围隔离。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    const file = path.join(directory, 'visual/cases/_shared/future.ts');
    const result = assertVisualGateStatus(directory, file, probe(4), 1);
    assert.match(result.stderr, /future.ts.*complexity/);
    writeFileSync(path.join(directory, 'visual/scenariosFuture.ts'), probe(4));
    const cases = runVisualGate(directory, '--cases');
    assert.equal(cases.status, 0, cases.stdout + cases.stderr);
    const all = runVisualGate(directory);
    assert.equal(all.status, 1, all.stdout + all.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('场景必需文件缺失或报告解析失败时非零退出', /** 防止删除源码或报告模式成功空跑。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    const file = path.join(directory, 'visual/cases/_shared/future.ts');
    writeFileSync(file, 'export function (');
    const report = runVisualGate(directory, '--cases', '--report');
    assert.equal(report.status, 1, report.stdout + report.stderr);
    assert.match(report.stderr, /复杂度测量解析失败/);
    rmSync(file);
    rmSync(path.join(directory, visualCaseSupportFiles[0]));
    const missing = runVisualGate(directory, '--cases');
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /视觉复杂度检查缺少文件/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
