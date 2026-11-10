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

/**
 * 生成独立计数的嵌套箭头回调，覆盖提取辅助实现中的回调边界。
 * @param complexity - 回调需要达到的复杂度。
 * @returns 临时回调源码。
 */
function nestedProbe(complexity) {
  return `export const values = [1].map(x => { ${'if (x) x++;'.repeat(complexity - 1)} return x; });`;
}

const extractedSupportFiles = [
  'visual/animations/appSessionBrowser.ts',
  'visual/animations/cardSpriteReadinessState.ts',
  'visual/animations/cardSpriteReadinessState.browser.ts',
  'visual/animations/readinessTestHelpers.ts',
  'visual/animations/slotBannerDiagnostics.ts',
];
const readinessSupportPaths = [
  'visual/animations/readinessTestHelpers.ts',
  'visual/animations/readinessTestHelpers.test.ts',
  'visual/animations/readinessTestHelpersState.mjs',
  'visual/animations/readinessTestHelpers/support.ts',
];

test('本 PR 实际提取模块独立于范围清单核对，两个入口均不得遗漏', /** 显式列出实际提取路径以发现清单自身的遗漏。 */ () => {
  const capture = captureComplexityFiles();
  const defaults = visualComplexityFiles();
  for (const file of extractedSupportFiles) {
    assert.ok(capture.includes(file), `采集入口遗漏 ${file}`);
    assert.ok(defaults.includes(file), `默认入口遗漏 ${file}`);
  }
  assert.deepEqual(captureFiles(readinessSupportPaths), readinessSupportPaths);
});

for (const file of readinessSupportPaths) {
  test(`${file} 实际辅助路径及相邻实现执行 3/4 边界`, /** 验证明确路径，避免断言依赖被测过滤器。 */ async () => {
    assert.deepEqual(await checkVisualComplexityText(probe(3), file), []);
    assert.ok((await checkVisualComplexityText(probe(4), file)).some(isComplexity));
  });
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

for (const modes of [['--capture'], []]) {
  for (const [name, source] of [['普通函数', probe], ['嵌套回调', nestedProbe]]) {
    test(`npm ${modes.join(' ') || '默认'}入口对实际就绪辅助模块的${name}执行 3/4 边界并拒绝禁用注释`, /** 在隔离副本替换曾漏扫的真实路径。 */ () => {
      const directory = isolatedVisualRepository();
      const file = path.join(directory, 'visual/animations/readinessTestHelpers.ts');
      try {
        assertVisualGateStatus(directory, file, source(3), 0, ...modes);
        const failure = assertVisualGateStatus(directory, file, source(4), 1, ...modes);
        assert.match(failure.stderr, /readinessTestHelpers\.ts:.*complexity:.*complexity of 4.*Maximum allowed is 3/);
        assertVisualGateStatus(directory, file, `/* eslint-disable complexity */\n${source(4)}`, 1, ...modes);
        assertVisualGateStatus(directory, file, `/* eslint complexity: ["error", 99] */\n${source(4)}`, 1, ...modes);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }
}

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
