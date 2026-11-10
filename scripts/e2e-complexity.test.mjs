import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repository, sourceFiles } from './source-files.mjs';
import { checkE2eComplexity, checkE2eComplexityText } from './e2e-complexity.mjs';
import { protocolSupportFiles } from './e2e-complexity-protocol-scope.mjs';
import { e2eSupportFiles } from './e2e-complexity-scope.mjs';

/**
 * 生成指定 classic 计数的临时函数。
 * @param count - 要求的复杂度。
 */
function sourceWithComplexity(count) {
  return `export const probe = (x) => { ${Array(count - 1).fill('if (x) x += 1;').join(' ')} return x; };`;
}

const supportPaths = [...e2eSupportFiles, ...protocolSupportFiles, 'e2e/helpers/new-helper.ts', 'e2e/interactions/new-helper.ts', 'e2e/interactions/new-browser.js', 'e2e/cases/_shared/new-helper.ts', 'scripts/e2e-complexity.test.mjs'];
const toolPaths = ['scripts/e2e-complexity-protocol-scope.mjs', 'scripts/e2e-complexity.mjs', 'scripts/e2e-complexity-scope.mjs', 'eslint.config.mjs'];
for (const [paths, limit] of [[supportPaths, 3], [toolPaths, 6]]) {
  for (const filePath of paths) {
    test(`${filePath} 的边界为 ${limit}/${limit + 1}`, /** 使用真实配置验证通过与拒绝边界。 */ async () => {
      assert.deepEqual(await checkE2eComplexityText(sourceWithComplexity(limit), filePath), []);
      const rejected = await checkE2eComplexityText(sourceWithComplexity(limit + 1), filePath);
      assert.equal(rejected[0].ruleId, 'complexity');
    });
  }
}

const branchProbes = [
  'const x = () => () => { if (a) a++; if (b) b++; if (c) c++; };',
  'class X { constructor(a = 0) { if (a) a++; if (b) b++; } }',
  'class X { get value() { return a ? b : c || d && e; } }',
  'class X { method(a = 0) { return a?.b?.c; } }',
  'const x = function(a = 0) { return a || b && c; };',
];
for (const probePath of ['e2e/cases/_shared/new-helper.ts', 'e2e/helpers/new-helper.ts', 'e2e/interactions/new-browser.js']) {
  for (const source of branchProbes) {
    test(`原生语法与嵌套回调计数 ${probePath}：${source}`, /** 禁止用宽松算法遗漏函数或分支。 */ async () => {
      const messages = await checkE2eComplexityText(source, probePath);
      assert.equal(messages[0].ruleId, 'complexity');
    });
  }

  for (const directive of ['/* eslint-disable */', '/* eslint-disable complexity, quality/no-quality-disable */', '/* eslint complexity: ["error", 99] */']) {
    test(`行内指令无法放宽预算 ${probePath}：${directive}`, /** 指令检查本身和原生复杂度均必须报错。 */ async () => {
      const messages = await checkE2eComplexityText(`${directive}\n${sourceWithComplexity(4)}`, probePath);
      assert.deepEqual(messages.map(/** 取出规则名。
       * @param message - 原生错误。 */ message => message.ruleId).sort(), ['complexity', 'quality/no-quality-disable']);
    });
  }
}

/**
 * 复制正式门禁源码，隔离负例与并发的全仓扫描；只读链接依赖和 Git 元数据。
 * @returns 由调用方清理的临时仓库。
 */
function isolatedRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-e2e-quality-'));
  const files = sourceFiles().filter(/** 复制真实入口、规则和被检查的源码。
   * @param file - 仓库相对路径。 */ file => /^(?:scripts\/|e2e\/.*\.[cm]?[jt]sx?$|eslint\.config\.mjs$|package\.json$)/.test(file));
  for (const file of files) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repository, file), target);
  }
  for (const entry of ['.git', 'node_modules']) symlinkSync(join(repository, entry), join(directory, entry));
  return directory;
}

/**
 * 在隔离仓库的真实范围内创建临时文件并执行正式命令入口，结束后清理。
 * @param source - 临时正例或负例。
 * @param probePath - 本轮探针路径。
 * @param protocolOnly - 定向入口参数。
 */
function runProbe(source, probePath, protocolOnly) {
  const directory = isolatedRepository();
  try {
    writeFileSync(join(directory, probePath), source);
    return spawnSync(process.execPath, ['scripts/e2e-complexity.mjs', ...protocolOnly], { cwd: directory, encoding: 'utf8' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

for (const [probePath, protocolOnly] of [
  ['e2e/cases/_shared/complexity-probe.ts', []],
  ['e2e/helpers/complexity-probe.ts', ['--protocol']],
  ['e2e/interactions/complexity-probe.js', ['--protocol']],
]) {
  for (const [source, status, diagnostic] of [
    [sourceWithComplexity(3), 0, /0 个违规/],
    [sourceWithComplexity(4), 1, /complexity of 4/],
    ['export function (', 1, /E2E 复杂度解析失败/],
    [`/* eslint-disable */\n${sourceWithComplexity(4)}`, 1, /complexity of 4/],
  ]) {
    test(`正式入口实际阻断 ${probePath}：${source}`, /** 核对进程退出码及可审阅诊断。 */ () => {
      const result = runProbe(source, probePath, protocolOnly);
      assert.equal(result.status, status);
      assert.match(result.stdout + result.stderr, diagnostic);
    });
  }
}

test('缺失文件和依赖必须失败，沿用现有 lint、pre-commit 与 CI', /** 验证失败关闭与调用链，不执行全仓 lint。 */ async () => {
  await assert.rejects(checkE2eComplexity(false, ['e2e/cases/_shared/absent.ts']), /No files matching/);
  const directory = mkdtempSync(join(tmpdir(), 'e2e-complexity-dependency-'));
  try {
    const isolated = join(directory, 'entry.mjs');
    writeFileSync(isolated, readFileSync(join(repository, 'scripts/e2e-complexity.mjs')));
    const result = spawnSync(process.execPath, [isolated], { encoding: 'utf8', cwd: directory });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['lint:js'], /^npm run lint:e2e-complexity &&/);
    assert.match(pkg.scripts.lint, /npm run lint:js/);
    assert.match(pkg.scripts.check, /^npm run lint &&/);
    assert.match(readFileSync(join(repository, '.pre-commit-config.yaml'), 'utf8'), /entry: npm run lint/);
    assert.match(readFileSync(join(repository, '.github/workflows/lint.yml'), 'utf8'), /pre-commit run --all-files/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
