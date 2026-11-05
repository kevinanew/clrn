import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './documentation-rule.mjs';
import { repository, sourceFiles } from './source-files.mjs';
import { runJSON } from './quality-lint.mjs';

const files = sourceFiles();
const javascript = files.filter(/** 选择所有 JS/TS 扩展名，包含声明文件的语法检查。
 * @param file - 源码候选路径。 */ file => /\.[cm]?[jt]sx?$/.test(file));
const python = files.filter(/** 选择 Python 模块与包。
 * @param file - 源码候选路径。 */ file => file.endsWith('.py'));
const shell = files.filter(/** 选择 Shell 入口脚本。
 * @param file - 源码候选路径。 */ file => file.endsWith('.sh'));
if (!javascript.length || !python.length) throw new Error('文档扫描为空，拒绝通过。');
if (files.some(/** 防止新增 Swift 源码后静默漏扫。
 * @param file - 源码候选路径。 */ file => file.endsWith('.swift'))) {
  throw new Error('发现 Swift 源码，请先接入 Swift 文档扫描。');
}
const findings = [];
const linter = new Linter();
for (const file of javascript) {
  const messages = linter.verify(readFileSync(`${repository}/${file}`, 'utf8'), [{
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { documentation: { rules: { purpose: rule } } }, rules: { 'documentation/purpose': 'error' },
  }], { filename: file, allowInlineConfig: false });
  for (const message of messages) findings.push({ file, line: message.line, rule: message.ruleId ?? 'parse-error', message: message.message });
}
const result = spawnSync('uv', ['run', '--no-project', '--python', '3.12.12', 'python', 'scripts/check-documentation.py'],
  { cwd: repository, input: JSON.stringify([...python, ...shell]), encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Python 文档检查异常：${result.stderr}`);
const supplemental = JSON.parse(result.stdout);
if (supplemental.files.python !== python.length || supplemental.files.shell !== shell.length) throw new Error('文档扫描数量不一致。');
findings.push(...supplemental.findings);
const ruff = runJSON('uvx', ['--from', 'ruff==0.15.12', 'ruff', 'check', '--isolated', '--ignore-noqa', '--no-cache',
  '--select', 'D100,D101,D102,D103,D104,D105,D106,D107,D419', '--output-format', 'json', ...python]);
if (ruff.status !== Number(ruff.report.length > 0)) throw new Error('Ruff 文档检查未正常完成。');
for (const item of ruff.report) findings.push({ file: item.filename, line: item.location.row, rule: item.code, message: item.message });
console.log(`文档扫描：JS/TS ${javascript.length}，Python ${python.length}，Shell ${shell.length} 个文件；${findings.length} 项诊断。`);
for (const item of findings) console.error(`${item.file}:${item.line} ${item.rule} ${item.message}`);
if (findings.length) process.exitCode = 1;
