import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { sourceFiles } from './source-files.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const eslint = new ESLint({ cwd: repository });

/**
 * 对内存中的示例代码应用真实 lint 配置，验证文档规则会阻止错误代码。
 *
 * @param source - 需要验证的示例代码，不会写入仓库。
 * @returns ESLint 对示例代码报告的问题。
 */
async function lintSource(source) {
  const [result] = await eslint.lintText(source, { filePath: 'scripts/lint-policy-probe.mjs' });
  return result.messages;
}

test('具备说明和参数描述的 TSDoc 可通过 lint', async () => {
  assert.deepEqual(await lintSource(`
    /**
     * 返回传入的值。
     * @param value - 待返回的值。
     * @returns 传入的值。
     */
    function documented(value) { return value; }
    documented(1);
  `), []);
});

test('缺少 TSDoc 的函数、命名箭头函数和类方法会被拒绝', async () => {
  for (const source of [
    'function undocumented() {} undocumented();',
    'const undocumented = () => {}; undocumented();',
    'const undocumented = function () {}; undocumented();',
    'class Undocumented { method() {} } new Undocumented().method();',
  ]) {
    const messages = await lintSource(source);
    assert.ok(messages.some(message => message.ruleId === 'jsdoc/require-jsdoc'));
  }
});

test('空注释不能冒充文档', async () => {
  const messages = await lintSource('/** */ function empty() {} empty();');
  assert.ok(messages.some(message => message.ruleId === 'jsdoc/require-description'));
});

test('JSDoc 类型写法及未知标签不符合 TSDoc，会被拒绝', async () => {
  const messages = await lintSource(`
    /**
     * 返回传入的值。
     * @param {string} value - 待返回的值。
     * @notATsdocTag 无效标签。
     */
    function malformed(value) { return value; }
    malformed('value');
  `);
  assert.ok(messages.some(message => message.ruleId === 'tsdoc/syntax'));
});

test('参数缺少说明时 lint 失败', async () => {
  const messages = await lintSource(`
    /** 返回传入的值。 */
    function missingParameter(value) { return value; }
    missingParameter(1);
  `);
  assert.ok(messages.some(message => message.ruleId === 'jsdoc/require-param'));
});

test('E2E 和视觉 TypeScript 同样强制函数与形参的 TSDoc', async () => {
  for (const filePath of ['e2e/lint-probe.ts', 'visual/src/lint-probe.ts']) {
    const [missingDoc] = await eslint.lintText('function probe(value: string) { return value; } probe("test");', { filePath });
    assert.ok(missingDoc.messages.some(message => message.ruleId === 'jsdoc/require-jsdoc'), filePath);
    const [missingParam] = await eslint.lintText('/** 返回参数。 */ function probe(value: string) { return value; } probe("test");', { filePath });
    assert.ok(missingParam.messages.some(message => message.ruleId === 'jsdoc/require-param'), filePath);
    const [valid] = await eslint.lintText('/** 返回凭据。\n * @param credentials - 包含 username 和 password 的登录凭据。\n */ function probe(credentials: { username: string; password: string }) { return credentials; } probe({username:"u",password:"p"});', { filePath });
    assert.deepEqual(valid.messages, []);
  }
});

test('全部 JavaScript 和 TypeScript 源文件均在 ESLint 覆盖范围内', async () => {
  const files = sourceFiles().filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file));
  assert.ok(files.some(file => file.startsWith('e2e/')));
  assert.ok(files.some(file => file.startsWith('visual/')));
  for (const file of files) assert.equal(await eslint.isPathIgnored(file), false, file);
});
