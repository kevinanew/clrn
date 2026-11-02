import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import quality from './quality-rules.mjs';
import { fingerprint } from './quality-baseline.mjs';
import { repository, sourceFiles } from './source-files.mjs';

/**
 * 执行只读工具并解析 JSON；工具异常、空输出、异常退出均不得静默通过。
 * @param command - 可执行程序。
 * @param args - 工具参数。
 * @returns 工具报告及退出码。
 */
export function runJSON(command, args) {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (![0, 1, 2].includes(result.status) || !result.stdout.trim()) throw new Error(`${command} 异常退出 ${result.status}: ${result.stderr}`);
  return { report: JSON.parse(result.stdout), status: result.status };
}

/**
 * 执行全仓 ESLint，保留原有规则和精确的无关行内例外。
 * @returns 所有未被 ESLint 抑制的诊断。
 */
export async function javascriptFindings() {
  const files = sourceFiles().filter(file => /\.[cm]?[jt]sx?$/.test(file));
  if (!files.length) throw new Error('ESLint 没有扫描到源码。');
  const results = await new ESLint({ cwd: repository }).lintFiles(files);
  const directiveChecker = new Linter();
  const findings = results.flatMap(result => {
    // 独立检查禁止的指令，防止 eslint-disable 把检查它自己的规则也关闭。
    const directives = directiveChecker.verify(result.source ?? readFileSync(result.filePath, 'utf8'), [{
      languageOptions: { parser: tseslint.parser }, linterOptions: { noInlineConfig: true },
      plugins: { quality }, rules: { 'quality/no-quality-disable': 'error' },
    }]).filter(item => item.ruleId === 'quality/no-quality-disable');
    const messages = new Map([...result.messages, ...directives].map(item => [JSON.stringify(item), item]));
    return [...messages.values()].map(message => ({
      file: relative(repository, result.filePath), rule: message.ruleId ?? 'parse-error',
      line: message.line ?? 1, column: message.column ?? 1, message: message.message,
    }));
  });
  return findings.map(fingerprint);
}

/**
 * 保留原 Ruff 门禁，并独立强制 C901 检查以阻止 noqa、配置忽略或阈值放宽。
 * @returns 去重后的全部 Python 诊断。
 */
export function pythonFindings() {
  const files = sourceFiles().filter(file => file.endsWith('.py'));
  if (!files.length) throw new Error('Ruff 没有扫描到源码。');
  const args = ['--from', 'ruff==0.15.12', 'ruff', 'check', '--no-cache', '--output-format', 'json'];
  const regular = runJSON('uvx', [...args, ...files]);
  const strict = runJSON('uvx', [...args, '--isolated', '--ignore-noqa', '--select', 'C901',
    '--config', 'lint.mccabe.max-complexity=10', ...files]);
  const unique = new Map();
  for (const item of [...regular.report, ...strict.report]) {
    const finding = {
      file: relative(repository, item.filename), rule: item.code,
      line: item.location.row, column: item.location.column, message: item.message,
    };
    unique.set(JSON.stringify(finding), finding);
  }
  return [...unique.values()].map(fingerprint);
}
