import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { repository, sourceFiles } from './source-files.mjs';
import { animationFiles, animationSupportFiles } from './visual-complexity-scope.mjs';
import { checkVisualComplexityText, visualComplexityFiles } from './visual-complexity.mjs';

/**
 * 用真实 ESLint classic 规则生成精确复杂度的临时函数。
 * @param complexity - 需要验证的复杂度。
 * @returns 临时源码。
 */
function probe(complexity) {
  return `export function probe(x) { ${'if (x) x++;'.repeat(complexity - 1)} return x; }`;
}

for (const file of animationFiles(sourceFiles())) {
  test(`${file} 包括拆分实现均执行 3/4 边界`, /** 核对实际文件路径的预算。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    assert.ok((await checkVisualComplexityText(probe(4), file)).some(/** 查找原生复杂度错误。
     * @param message - ESLint 诊断。 */ message => message.ruleId === 'complexity'));
  });
}

for (const source of [
  'export function outer() { return () => { if (a) a++; if (b) b++; if (c) c++; }; }',
  'export const helper = (value = 0) => value?.a || value.b;',
  '/* eslint-disable complexity */ export function helper(x) { if (x) x++; if (x) x++; if (x) x++; }',
  '/* eslint complexity: ["error", 99] */ export function helper(x) { if (x) x++; if (x) x++; if (x) x++; }',
]) {
  test(`动画辅助模块不能绕过嵌套、语法分支或禁用指令：${source}`, /** 按新增模块路径验证相同预算。 */ async () => {
    const messages = await checkVisualComplexityText(source, 'visual/animations/timelineFutureHelper.ts');
    assert.ok(messages.some(/** 嵌套及注释后的函数仍须超限。
     * @param message - 原生诊断。 */ message => message.ruleId === 'complexity'));
  });
}

test('动画独立门禁完整包含原文件与新模块，不依赖其他目录清零', /** 核对独立文件范围。 */ () => {
  const files = visualComplexityFiles(true);
  for (const file of animationSupportFiles) assert.ok(files.includes(file));
  assert.deepEqual(animationFiles(files).sort(), animationFiles(sourceFiles()).sort());
  assert.equal(files.includes('visual/scenarios.ts'), false);
});

/**
 * 通过正式 npm 入口检查实际退出状态。
 * @returns 定向门禁子进程结果。
 */
function runGate() {
  return spawnSync('npm', ['run', 'lint:visual-complexity', '--', '--animations'],
    { cwd: repository, encoding: 'utf8', timeout: 30_000 });
}

/**
 * 向同名前缀的新模块写入临时源码并调用真实门禁。
 * @param file - 唯一临时模块路径。
 * @param source - 正例、负例或解析错误。
 * @param expected - 预期退出码。
 */
function assertGateStatus(file, source, expected) {
  writeFileSync(file, source);
  const result = runGate();
  assert.ifError(result.error);
  assert.equal(result.status, expected, result.stdout + result.stderr);
}

test('npm 入口实际阻断新增辅助模块的 4、禁用注释及解析失败，3 通过', /** 临时负例必须改变真实入口的退出状态。 */ () => {
  const file = path.join(repository, `visual/animations/timelineComplexityProbe-${randomUUID()}.ts`);
  try {
    assertGateStatus(file, probe(3), 0);
    assertGateStatus(file, probe(4), 1);
    assertGateStatus(file, `/* eslint-disable */\n${probe(4)}`, 1);
    assertGateStatus(file, 'export function (', 1);
  } finally {
    rmSync(file, { force: true });
  }
});
