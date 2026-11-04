import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import purpose from './documentation-rule.mjs';
import { repository } from './source-files.mjs';
import { documentedLineAnchor } from './quality-baseline.mjs';
import { projectJavascript } from './documentation-projection.mjs';

/** 对内存源码执行不可被行内指令禁用的逐实现文档检查。
 * @param source - 用于验证规则的源码。
 * @returns 包含语法错误的全部文档诊断。 */
function lint(source) {
  return new Linter().verify(source, [{
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { documentation: { rules: { purpose } } }, rules: { 'documentation/purpose': 'error' },
  }], { filename: 'probe.ts', allowInlineConfig: false });
}

test('普通、异步、生成器、方法、构造器和访问器都必须有自身说明', /** 覆盖全部有实现体的函数语法，并验证有效技术摘要。 */ () => {
  for (const source of [
    'function read() {}', 'async function read() {}', 'function* values() { yield 1; }',
    'const read = function () {};', 'const read = async () => 1;',
    'class Cache { constructor() {} get value() { return 1; } set value(next) {} *values() {} }',
    'const cache = { read() {}, get value() { return 1; }, write: () => {} };',
    'function outer() { function inner() {} return () => inner(); }',
  ]) assert.ok(lint(source).some(/** 确认当前语法形式产生缺失文档诊断。
   * @param item - 当前规则诊断。 */ item => item.messageId === 'missing'), source);
  assert.deepEqual(lint(`
    /** Read the cached value. */ async function read() { return 1; }
    /** 依次提供缓存值。 */ function* values() { yield 1; }
    const cache = { /** 读取缓存值。 */ read: () => read() };
    /** 缓存容器。 */ class Cache {
      /** 初始化缓存。 */ constructor() {}
      /** 读取当前值。 */ get value() { return 1; }
      /** 更新当前值。 */ set value(next: number) {}
    }
    declare function signature(value: number): number;
    function overloaded(value: number): number;
    /** 返回数值。 */ function overloaded(value: number) { return value; }
    const identity = /** 保留传入值的泛型类型。 */ async <T>(value: T): Promise<T> => value;
  `), []);
});

test('重复检查的文档投影保留代码、普通注释和字符串中的注释标记', /** 验证只读投影不会隐藏新增实现或改变敏感词元。 */ () => {
  const reference = '/** 读取缓存。 */ const read = () => "literal /** marker */"; // 保留普通注释\n';
  const current = reference + '/** 验证读取。 */ test("read", /** 检查缓存文本。 */ () => read());\n';
  const projected = projectJavascript(current, reference, 'probe.ts');
  assert.equal(projected, reference + 'test("read", () => read());\n');
  assert.match(projectJavascript('const changed = () => "new code";', reference, 'probe.ts'), /"new code"/);
});

test('空摘要、仅标签、链接、示例与非法 TSDoc 均失败', /** 确认格式合法与用途非空是分别执行的约束。 */ () => {
  for (const doc of ['', '   ', '@param value - 输入。', '{@link https://example.invalid}',
    'https://example.invalid', '[参考资料](https://example.invalid)', '[参考资料][source]',
    '@example\n```ts\nread();\n```', '\n```ts\nread();\n```', '!!!']) {
    assert.ok(lint(`/** ${doc} */ function read(value) { return value; }`)
      .some(/** 确认没有正文的注释被识别为空摘要。
       * @param item - 当前规则诊断。 */ item => item.messageId === 'empty'), doc);
  }
  for (const source of [
    '/** 读取数值。 @unknownTag 错误。 */ function read() {}',
    '/** 模块说明。 @unknownTag 错误。 */ const version = 1;',
    '/** 读取数值。 @param {number} value - 输入。 */ function read(value) { return value; }',
  ]) assert.ok(lint(source).some(/** 确认所有文档块都经过参考解析器。
   * @param item - 当前规则诊断。 */ item => item.messageId === 'syntax'), source);
});

test('suite、回调、嵌套实现和行内禁用不能借用外层说明', /** 验证文档归属精确绑定到当前实现。 */ () => {
  for (const source of [
    '/** 覆盖缓存读取。 */ test("read", () => {});',
    'test("read", /** 验证读取。 */ () => [1].map(value => value));',
    '/** 初始化缓存。 */ function outer() { return () => 1; }',
    '/* eslint-disable documentation/purpose */ const read = () => 1;',
  ]) assert.ok(lint(source).some(/** 确认未独立说明的实现仍然失败。
   * @param item - 当前规则诊断。 */ item => item.messageId === 'missing'), source);
  assert.deepEqual(lint('test("read", /** 验证读取。 */ () => [1].map(/** 保留当前数值。 */ value => value));'), []);
  assert.ok(lint('function broken(').some(/** 确认解析失败不等于零违规。
   * @param item - 当前语法诊断。 */ item => item.fatal));
});

test('注释跨行不改变历史源码指纹，真实代码与字符串变化仍改变指纹', /** 核验文档插入不会扩张历史违规名额。 */ () => {
  const original = 'const run = () => source.map(value => value + 1);';
  const documented = 'const run = /** 遍历数据。\n * @param source - 输入。 */ () => source.map(/** 递增数值。\n * @param value - 当前数值。 */ value => value + 1);';
  assert.equal(documentedLineAnchor(documented, documented.split('\n'), 3),
    documentedLineAnchor(original, [original], 1));
  assert.notEqual(documentedLineAnchor(documented.replace('value + 1', 'value + 2'), documented.replace('value + 1', 'value + 2').split('\n'), 3),
    documentedLineAnchor(original, [original], 1));
  const text = 'const value = "literal /** marker */ and spaces";';
  assert.notEqual(documentedLineAnchor(text, [text], 1), documentedLineAnchor(text.replace('and spaces', 'and  spaces'), [text.replace('and spaces', 'and  spaces')], 1));
});

test('Python 私有方法、lambda 注释与 Shell 入口接受正例并拒绝负例', /** 使用真实 Python 补充检查器核验边界行为。 */ () => {
  const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12', 'python', 'scripts/test_documentation.py'],
    { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('统一文档入口拒绝空扫描与缺失工具', /** 在独立 Git 仓库中执行真实 CLI，防止工具异常被记为通过。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-documentation-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const file of ['documentation.mjs', 'documentation-rule.mjs', 'source-files.mjs', 'quality-lint.mjs', 'quality-rules.mjs', 'quality-baseline.mjs']) {
      copyFileSync(join(repository, 'scripts', file), join(directory, 'scripts', file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir');
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: directory });
    assert.equal(initialized.status, 0);
    const empty = spawnSync(process.execPath, ['scripts/documentation.mjs'], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /扫描为空/);
    writeFileSync(join(directory, 'probe.py'), '"""工具缺失探测模块。"""\n');
    const missing = spawnSync(process.execPath, ['scripts/documentation.mjs'],
      { cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ENOENT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
