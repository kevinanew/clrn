import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { repository } from './source-files.mjs';
import { checkToolComplexity, checkToolComplexityText, toolComplexityFiles } from './tool-complexity.mjs';
import { generalToolFiles, toolScopeFiles } from './tool-complexity-scope.mjs';

/** 生成由 ESLint classic 计数的临时源码。
 * @param count - 预期复杂度。 */
function probe(count) {
  return `export const probe = x => { ${Array(count - 1).fill('if (x) x++;').join(' ')} return x; };`;
}

const supportPaths = [...toolScopeFiles.filter(/** 工具清单以外全部适用测试预算。
 * @param file - 原始范围路径。 */ file => !generalToolFiles.includes(file)),
'scripts/prepare-test-account-new-helper.ts', 'scripts/prepare-test-account/helpers/new.mjs',
'scripts/tool-complexity.test.mjs'];

for (const [files, limit] of [[supportPaths, 3], [generalToolFiles, 6]]) {
  for (const filePath of files) {
    test(`${filePath} 严格执行 ${limit}/${limit + 1} 边界`, /** 使用真实配置验证上下边界。 */ async () => {
      const source = filePath.endsWith('.cjs') ? probe(limit).replace('export ', '') : probe(limit);
      assert.deepEqual(await checkToolComplexityText(source, filePath), []);
      const rejected = await checkToolComplexityText(source.replace('return x;', 'if (x) x++; return x;'), filePath);
      assert.equal(rejected[0].ruleId, 'complexity');
    });
  }
}

for (const source of [
  'const x = () => () => { if (a) a++; if (b) b++; if (c) c++; };',
  'class X { constructor(a = 0) { if (a) a++; if (b) b++; } }',
  'class X { get value() { return a ? b : c || d && e; } }',
  'class X { method(a = 0) { return a?.b?.c; } }',
  'const x = function(a = 0) { return a || b && c; };',
]) {
  test(`原生 classic 独立计数：${source}`, /** 嵌套函数、访问器、默认值与可选链均不可漏计。 */ async () => {
    const messages = await checkToolComplexityText(source, 'scripts/prepare-test-account-probe.mjs');
    assert.equal(messages[0].ruleId, 'complexity');
  });
}

for (const directive of ['/* eslint-disable */', '/* eslint-disable complexity, quality/no-quality-disable */',
  '/* eslint complexity: ["error", 99] */', '// eslint-disable-next-line complexity']) {
  test(`禁用注释不能绕过：${directive}`, /** 复杂度和违规指令都必须报错。 */ async () => {
    const messages = await checkToolComplexityText(`${directive}\n${probe(4)}`, 'scripts/prepare-test-account-probe.mjs');
    assert.deepEqual(messages.map(/** 提取原生规则名。
     * @param message - ESLint 诊断。 */ message => message.ruleId).sort(), ['complexity', 'quality/no-quality-disable']);
  });
}

/** 复制真实配置与源码，避免临时负例污染并发检查。
 * @param context - 当前用例的清理出口。 */
function isolatedRepository(context) {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-tools-complexity-'));
  context.after(/** 删除临时仓库。 */ () => rmSync(directory, { force: true, recursive: true }));
  const files = new Set([...toolComplexityFiles(), 'package.json',
    'scripts/visual-complexity-scope.mjs', 'scripts/e2e-complexity-scope.mjs', 'scripts/documentation-rule.mjs']);
  for (const file of files) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repository, file), target);
  }
  symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'));
  execFileSync('git', ['init', '--quiet', directory]);
  return directory;
}

/** 执行复制的正式门禁，保持真实退出码与错误输出。
 * @param directory - 临时仓库。
 * @param args - 可选命令参数。 */
function runGate(directory, ...args) {
  return spawnSync(process.execPath, ['scripts/tool-complexity.mjs', ...args], { cwd: directory, encoding: 'utf8' });
}

for (const [source, file, status, diagnostic] of [
  [probe(3), 'scripts/prepare-test-account-probe.mjs', 0, /0 个违规/],
  [probe(4), 'scripts/prepare-test-account-probe.mjs', 1, /complexity of 4/],
  [probe(6), 'lint-lines.mjs', 0, /0 个违规/],
  [probe(7), 'lint-lines.mjs', 1, /complexity of 7/],
  ['export function (', 'scripts/prepare-test-account-probe.mjs', 1, /Parsing error/],
  [`/* eslint-disable */\n${probe(4)}`, 'scripts/prepare-test-account-probe.mjs', 1, /complexity of 4/],
]) {
  test(`正式入口阻断 ${file}: ${source}`, /** 临时静态正负例必须影响进程退出码。
   * @param context - 用例清理出口。 */ context => {
    const directory = isolatedRepository(context);
    writeFileSync(join(directory, file), source);
    const result = runGate(directory);
    assert.equal(result.status, status, result.stderr);
    assert.match(result.stdout + result.stderr, diagnostic);
  });
}

test('缺少依赖、原始文件或解析失败都拒绝成功报告', /** 验证失败关闭而不执行其他目录的门禁。
 * @param context - 用例清理出口。 */ async context => {
  await assert.rejects(checkToolComplexity(false, ['scripts/prepare-test-account-absent.mjs']), /No files matching/);
  const directory = isolatedRepository(context);
  rmSync(join(directory, 'node_modules'));
  const missingDependency = runGate(directory);
  assert.equal(missingDependency.status, 1);
  assert.match(missingDependency.stderr, /ERR_MODULE_NOT_FOUND/);
  symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'));
  rmSync(join(directory, 'scripts/prepare-test-account.mjs'));
  const missingFile = runGate(directory);
  assert.equal(missingFile.status, 1);
  assert.match(missingFile.stderr, /工具复杂度检查缺少文件/);
  writeFileSync(join(directory, 'scripts/prepare-test-account.mjs'), 'export function (');
  const parseFailure = runGate(directory, '--report');
  assert.equal(parseFailure.status, 1);
  assert.match(parseFailure.stderr, /工具复杂度解析失败/);
});

test('门禁沿用 lint、check、pre-commit 和 CI 调用链', /** 仅读取现有接线，避免运行全仓检查。 */ () => {
  const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['lint:js'], /npm run lint:tool-complexity &&/);
  assert.equal(pkg.scripts['lint:tool-complexity'], 'node scripts/tool-complexity.mjs');
  assert.match(pkg.scripts.lint, /npm run lint:js/);
  assert.match(pkg.scripts.check, /^npm run lint &&/);
  assert.match(readFileSync(join(repository, '.pre-commit-config.yaml'), 'utf8'), /entry: npm run lint/);
  assert.match(readFileSync(join(repository, '.github/workflows/lint.yml'), 'utf8'), /pre-commit run --all-files/);
});
