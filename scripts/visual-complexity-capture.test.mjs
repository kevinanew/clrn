/** Issue 102 采集辅助实现的逐路径预算与真实入口阻断回归。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureFiles, captureSupportFiles } from './visual-complexity-capture-scope.mjs';
import { captureComplexityFiles, checkVisualComplexityText, visualComplexityFiles } from './visual-complexity.mjs';
import { isolatedVisualRepository, assertVisualGateStatus, runVisualGate } from './visual-complexity-fixture.mjs';
import { sourceFiles } from './source-files.mjs';

/**
 * 使用 ESLint classic 的精确数量生成正负例。
 * @param complexity - 需要验证的复杂度。
 * @returns 临时源码。
 */
function probe(complexity) {
  return `export function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`;
}

for (const file of captureFiles(sourceFiles())) {
  test(`${file} 原模块、测试及拆出实现均执行 3/4 边界`, /** 逐路径验证实际配置。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    assert.ok((await checkVisualComplexityText(probe(4), file)).some(isComplexity));
  });
}

for (const file of ['eslint.config.mjs', 'scripts/visual-complexity-capture-scope.mjs']) {
  test(`${file} 独立检查工具及根配置执行 6/7 边界`, /** 验证已有工具预算。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(6), file), []);
    assert.ok((await checkVisualComplexityText(probe(7), file)).some(isComplexity));
  });
}

for (const source of [
  'export function outer() { return () => { if (a) a++; if (b) b++; if (c) c++; }; }',
  'export class Probe { constructor(x = 0) { if (x) x++; if (x) x++; } }',
  'export class Probe { get value() { if (a) a++; if (b) b++; return c ? 1 : 0; } }',
  'export const helper = (x = 0) => x?.a || x.b;',
  `/* eslint-disable complexity */ ${probe(4)}`,
  `/* eslint complexity: ["error", 99] */ ${probe(4)}`,
]) {
  test(`采集辅助实现不能绕过嵌套、默认参数、可选链或禁用注释：${source}`, /** 检查新模块不能放宽预算。 */ async () => {
    const messages = await checkVisualComplexityText(source, 'visual/animations/cardSpriteReadinessFuture/support.ts');
    assert.ok(messages.some(isComplexity));
  });
}

/**
 * 查找 ESLint 原生超限诊断。
 * @param message - 原生诊断。
 * @returns 是否超限。
 */
function isComplexity(message) { return message.ruleId === 'complexity'; }

test('独立采集范围覆盖原模块和新实现，默认 lint 入口也强制扫描', /** 核对范围完整性与入口接线。 */ () => {
  const files = captureComplexityFiles();
  for (const file of captureSupportFiles) assert.ok(files.includes(file));
  assert.deepEqual(captureFiles(files), captureFiles(sourceFiles()));
  const defaultFiles = visualComplexityFiles();
  assert.ok(files.every(/** 默认入口不得漏掉定向文件。
   * @param file - 当前门禁文件。 */ file => defaultFiles.includes(file)));
  assert.equal(files.includes('visual/scenarios.ts'), false);
  assert.equal(files.includes('visual/animations/timeline.ts'), false);
});

test('npm 定向入口实际阻断辅助实现 4、禁用指令与解析错误，3 通过', /** 临时文件只写隔离仓库。 */ () => {
  const directory = isolatedVisualRepository();
  const file = path.join(directory, `visual/animations/cardSpriteReadinessProbe-${randomUUID()}.ts`);
  try {
    assertVisualGateStatus(directory, file, probe(3), 0, '--capture');
    assertVisualGateStatus(directory, file, probe(4), 1, '--capture');
    assertVisualGateStatus(directory, file, `/* eslint-disable */\n${probe(3)}`, 1, '--capture');
    assertVisualGateStatus(directory, file, 'export function (', 1, '--capture');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('npm 定向与默认入口都阻断工具 7，工具 6 通过', /** 共享工具采用精确 6/7 边界。 */ () => {
  const directory = isolatedVisualRepository();
  const file = path.join(directory, `scripts/visual-complexity-capture-probe-${randomUUID()}.mjs`);
  try {
    assertVisualGateStatus(directory, file, probe(6), 0, '--capture');
    assertVisualGateStatus(directory, file, probe(7), 1, '--capture');
    assertVisualGateStatus(directory, file, probe(7), 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('删除原模块时采集入口非零退出，互斥参数不能意外切换范围', /** 缺少源码与入口误用都必须明确失败。 */ () => {
  const directory = isolatedVisualRepository();
  try {
    rmSync(path.join(directory, captureSupportFiles[0]));
    const missing = runVisualGate(directory, '--capture');
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /动画采集复杂度检查缺少文件/);
    const conflicting = runVisualGate(directory, '--capture', '--animations');
    assert.equal(conflicting.status, 1);
    assert.match(conflicting.stderr, /不能与其他定向参数同时使用/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('采集门禁沿用 lint、pre-commit 与 CI 调用链', /** 只验证已有调用链，不执行全仓检查。 */ () => {
  assert.match(readFileSync('package.json', 'utf8'), /lint:visual-complexity && node scripts\/quality.mjs javascript/);
  assert.match(readFileSync('.pre-commit-config.yaml', 'utf8'), /entry: npm run lint/);
  assert.match(readFileSync('.github/workflows/lint.yml', 'utf8'), /pre-commit run --all-files/);
});
