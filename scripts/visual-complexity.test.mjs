import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repository } from './source-files.mjs';
import { checkVisualComplexity, checkVisualComplexityText } from './visual-complexity.mjs';
import { visualSupportFiles, visualToolFiles } from './visual-complexity-scope.mjs';


/**
 * 用真实配置检查内存负例，避免把负例留在源码扫描范围。
 * @param source - 静态正例或负例。
 * @param filePath - 需要验证的真实预算路径。
 * @returns 原生 ESLint 诊断。
 */
async function messages(source, filePath) {
  return checkVisualComplexityText(source, filePath);
}

/**
 * 生成精确 classic 复杂度的函数。
 * @param complexity - 预期复杂度。
 * @returns 包含指定数量独立分支的源码。
 */
function probe(complexity) {
  return `export function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`;
}

/**
 * 读取复杂度诊断，忽略与本门禁无关的文档规则。
 * @param diagnostics - ESLint 诊断。
 * @returns 是否包含超限错误。
 */
function hasComplexity(diagnostics) {
  return diagnostics.some(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message => message.ruleId === 'complexity');
}

for (const file of visualSupportFiles) {
  test(`${file} 明确适用测试/辅助上限 3`, /** 执行当前测试或处理逻辑。 */ async () => {
    assert.equal(hasComplexity(await messages(probe(3), file)), false);
    assert.equal(hasComplexity(await messages(probe(4), file)), true);
  });
}

for (const file of [...visualToolFiles, 'eslint.config.mjs', 'scripts/visual-complexity.mjs']) {
  test(`${file} 明确适用独立工具/配置上限 6`, /** 执行当前测试或处理逻辑。 */ async () => {
    assert.equal(hasComplexity(await messages(probe(6), file)), false);
    assert.equal(hasComplexity(await messages(probe(7), file)), true);
  });
}

for (const source of [
  'export function outer() { return () => { if (a) a++; if (b) b++; if (c) c++; }; }',
  'export class Probe { constructor(x = 0) { if (x) x++; if (x) x++; } }',
  'export class Probe { get value() { if (a) a++; if (b) b++; return c ? 1 : 0; } }',
  'export const probe = function(x = 0) { return x?.a?.b; };',
  'export const probe = (x = 0) => x || a && b;',
]) {
  test(`嵌套回调、方法和语法分支均计数：${source}`, /** 执行当前测试或处理逻辑。 */ async () => {
    assert.equal(hasComplexity(await messages(source, 'visual/run-visual-config.ts')), true);
  });
}

for (const directive of ['/* eslint-disable */', '/* eslint-disable complexity, quality/no-quality-disable */',
  '/* eslint complexity: ["error", 99] */']) {
  test(`禁用注释不能绕过门禁：${directive}`, /** 执行当前测试或处理逻辑。 */ async () => {
    const diagnostics = await messages(`${directive}\n${probe(4)}`, 'visual/scenarios.ts');
    assert.equal(hasComplexity(diagnostics), true);
    assert.ok(diagnostics.some(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message => message.ruleId === 'quality/no-quality-disable'));
  });
}

test('独立门禁保留解析失败和缺失文件错误', /** 执行当前测试或处理逻辑。 */ async () => {
  const diagnostics = await messages('export function (', 'visual/scenarios.ts');
  assert.ok(diagnostics.some(/** 根据当前条目计算结果。
 * @param message - 当前回调参数。 */ message => message.fatal));
  await assert.rejects(checkVisualComplexity(['visual/missing-complexity-probe.ts']), /No files matching/);
});

test('检查入口缺失依赖时非零退出，lint、pre-commit 和 CI 保留调用链', /** 执行当前测试或处理逻辑。 */ () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'visual-complexity-missing-dependency-'));
  try {
    const entry = path.join(directory, 'visual-complexity.mjs');
    writeFileSync(entry, readFileSync(path.join(repository, 'scripts/visual-complexity.mjs')));
    const result = spawnSync(process.execPath, [entry], { encoding: 'utf8', cwd: directory });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(readFileSync(path.join(repository, 'package.json'), 'utf8'), /lint:visual-complexity && npm run lint:tool-complexity && node scripts\/quality.mjs javascript/);
    assert.match(readFileSync(path.join(repository, '.pre-commit-config.yaml'), 'utf8'), /entry: npm run lint/);
    assert.match(readFileSync(path.join(repository, '.github/workflows/lint.yml'), 'utf8'), /pre-commit run --all-files/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
