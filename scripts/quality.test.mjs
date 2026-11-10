import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ESLint } from 'eslint';
import { assertShrinking, fingerprint, newFindings } from './quality-baseline.mjs';
import { repository } from './source-files.mjs';
import { duplicationReference, projectJavascript } from './documentation-projection.mjs';

const eslint = new ESLint({ cwd: repository });

test('违规指纹按文件扩展名解析 TypeScript 泛型和 TSX', /** 验证泛型不会被误读为 JSX，且 TSX 仍可生成指纹。 */ () => {
  for (const [file, source] of [
    ['probe.ts', 'const probe = <T>(value: T) => value;'],
    ['probe.tsx', 'const probe = <span />;'],
  ]) {
    const finding = { file, rule: 'complexity', line: 1, column: 1, message: 'probe' };
    const documented = source.replace('= ', '= /** 说明。\n */ ');
    assert.equal(fingerprint(finding, source).anchor,
      fingerprint({ ...finding, line: 2 }, documented).anchor);
    assert.notEqual(fingerprint(finding, source).anchor,
      fingerprint(finding, source.replace('probe', 'changed')).anchor);
  }
});

test('解析错误保留原始行指纹并作为新增违规阻断门禁', /** 验证无效源码不会在指纹计算时再次解析并丢失诊断。 */ () => {
  const source = 'export function (';
  const finding = { file: 'e2e/cases/_shared/complexity-probe-regression/probe.ts', rule: 'parse-error',
    line: 1, column: 17, message: 'Parsing error: Identifier expected.' };
  const result = fingerprint(finding, source);
  assert.deepEqual(result, { ...finding, anchor: fingerprint({ ...finding, file: 'probe.py' }, source).anchor });
  assert.deepEqual(newFindings([result], []), [result]);
});

test('指纹使用诊断时的源码，临时文件删除后仍保留违规', /** 验证指纹不重读已清理的临时文件。 */ () => {
  const directory = mkdtempSync(join(repository, '.quality-probe-'));
  const file = join(directory, 'probe.ts');
  const source = 'await page.route("**", handler);\n';
  const finding = { file: file.slice(repository.length + 1), rule: 'quality/no-network-response', line: 1 };
  try {
    writeFileSync(file, source);
    const expected = fingerprint(finding);
    rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(fingerprint(finding, source), expected);
    assert.throws(/** 缺少源码快照时仍必须报告文件缺失。 */ () => fingerprint(finding), { code: 'ENOENT' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/**
 * 对内存负例运行真实配置，不创建业务或浏览器连接。
 * @param source - 临时源码。
 * @returns ESLint 诊断。
 */
async function lint(source) {
  const [result] = await eslint.lintText(source, { filePath: 'e2e/cases/quality-probe.ts' });
  return result.messages;
}

test('复杂度 10 和嵌套 3 是实际失败阈值', /** 验证复杂度 10 和嵌套 3 是实际失败阈值。 */ async () => {
  const branches = Array.from({ length: 10 }, /** 生成十个独立条件分支，构造超出 JS 复杂度上限的负例。
 * @param _ - 当前操作使用的 _。
 * @param n - 当前生成项的索引。 */ (_, n) => `if (x === ${n}) return ${n};`).join('\n');
  assert.ok((await lint(`function probe(x: number) { ${branches} return -1; } probe(0);`))
    .some(/** 确认超限分支触发复杂度诊断。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'complexity'));
  assert.ok((await lint('function deep(x: boolean) { if(x) { if(x) { if(x) { if(x) { return 1; } } } } } deep(true);'))
    .some(/** 确认超限嵌套触发深度诊断。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'max-depth'));
  const config = await eslint.calculateConfigForFile('quality-probe.ts');
  assert.deepEqual(config.rules.complexity, [2, { max: 10, variant: 'classic' }]);
  assert.deepEqual(config.rules['max-depth'], [2, 3]);
  const protocol = await eslint.calculateConfigForFile('e2e/helpers/scenario-proxy.ts');
  assert.deepEqual(protocol.rules.complexity, [2, { max: 3, variant: 'classic' }]);
});

test('网络响应语法覆盖直接、下标、可选链、别名、服务器与 mock 接口', /** 验证网络响应语法覆盖直接、下标、可选链、别名、服务器与 mock 接口。 */ async () => {
  for (const source of [
    'page.route("**", handler);', 'route?.["fulfill"]({json:{}});',
    'const respond = route.fulfill.bind(route); respond({});',
    'const { route: intercept } = page; intercept("**", handler);',
    'page[`routeFromHAR`]("fixture.har");', 'page.routeWebSocket("**", handler);',
    'import {createServer as server} from "node:http"; server(handler);',
    'globalThis.fetch = handler;', 'context.mock.method(globalThis, "fetch", handler);',
    'sinon.stub(page, "route");', 'import {http} from "msw"; http.get("/", handler);',
  ]) {
    assert.ok((await lint(source)).some(/** 确认各类 TypeScript 响应伪造入口均被边界规则识别。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'quality/no-network-response'), source);
  }
});

test('注释、文本、普通网络读取、展示数据及代理场景控制不误报', /** 验证注释、文本、普通网络读取、展示数据及代理场景控制不误报。 */ async () => {
  const messages = await lint(`
    // page.route('**', handler); route.fulfill({json:{}});
    const documentation = 'route.fulfill({})';
    await fetch('/read'); await selectScenario(context, 'logical-scenario');
    const presentation = { route: 'data-only', fulfill: 'data-only' };
    console.log(documentation, presentation);
  `);
  assert.equal(messages.filter(/** 仅统计网络边界诊断，验证字符串和普通数据不会误报。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'quality/no-network-response').length, 0);
});

test('历史条目按身份和次数消费，复制、替换、提高复杂度、扩张基线均失败', /** 验证历史条目按身份和次数消费，复制、替换、提高复杂度、扩张基线均失败。 */ () => {
  const old = { file: 'adapter.ts', rule: 'complexity', anchor: 'hash', message: 'complexity 11' };
  assert.deepEqual(newFindings([old], [old]), []);
  assert.equal(newFindings([old, old], [old]).length, 1);
  assert.equal(newFindings([{ ...old, file: 'other.ts' }], [old]).length, 1);
  assert.equal(newFindings([{ ...old, message: 'complexity 12' }], [old]).length, 1);
  assert.throws(/** 尝试增加相同历史违规的次数，验证清单不能扩张。 */ () => assertShrinking({ findings: [old, old] }, { findings: [old] }));
  assert.throws(/** 尝试提高原生重复指纹次数，验证重复基线只能缩减。 */ () => assertShrinking({ findings: [], fingerprints: { hash: 2 } }, { findings: [], fingerprints: { hash: 1 } }));
  assert.doesNotThrow(/** 验证删除历史问题符合只减不增的清单约束。 */ () => assertShrinking({ findings: [] }, { findings: [old] }));
});

/**
 * 调用仓库内固定版本的命令，保留真实退出码供断言。
 * @param tool - Node CLI 相对路径。
 * @param args - CLI 参数。
 * @param cwd - 隔离的工作目录。
 * @returns 子进程执行结果。
 */
function invoke(tool, args, cwd) {
  const result = spawnSync(process.execPath, [join(repository, tool), ...args], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

test('真实 dependency-cruiser 阻止循环、直接/间接越层和无法解析的本地导入', /** 验证真实 dependency-cruiser 阻止循环、直接/间接越层和无法解析的本地导入。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-architecture-'));
  try {
    mkdirSync(join(directory, 'visual/cases'), { recursive: true });
    mkdirSync(join(directory, 'e2e/mitmproxy'), { recursive: true });
    writeFileSync(join(directory, 'tsconfig.json'), '{"compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}');
    writeFileSync(join(directory, 'a.ts'), "import './b'; export const a = 1;\n");
    writeFileSync(join(directory, 'b.ts'), "import './a'; export const b = 2;\n");
    writeFileSync(join(directory, 'e2e/mitmproxy/response.ts'), 'export const response = {};\n');
    writeFileSync(join(directory, 'bridge.ts'), "export * from './e2e/mitmproxy/response';\n");
    writeFileSync(join(directory, 'visual/cases/probe.ts'), "import '../../bridge'; import '../../e2e/mitmproxy/response'; import './missing';\n");
    const result = invoke('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs',
      ['--config', join(repository, '.dependency-cruiser.cjs'), '--output-type', 'json', '.'], directory);
    const { summary } = JSON.parse(result.stdout);
    assert.ok(summary.advisedExitCode > 0);
    const names = new Set(summary.violations.map(/** 提取依赖违规的规则名，核对循环与越层规则均已生效。
 * @param item - 当前遍历的条目。 */ item => item.rule.name));
    for (const name of ['no-cycles', 'ui-no-response-implementation', 'no-unresolved-local-imports']) assert.ok(names.has(name), name);
    assert.ok(summary.violations.some(/** 确认间接越层被报告为可达性违规。
 * @param item - 当前遍历的条目。 */ item => item.type === 'reachability'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('真实 jscpd 的原生基线允许旧重复，阻止新内容及第三份历史副本', /** 验证真实 jscpd 的原生基线允许旧重复，阻止新内容及第三份历史副本。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-duplication-'));
  try {
    const source = Array.from({ length: 14 }, /** 生成可识别的连续代码，验证 jscpd 新增重复检测。
 * @param _ - 当前操作使用的 _。
 * @param n - 当前生成项的索引。 */ (_, n) => `console.log('unique-quality-${n}', ${n} + input);`).join('\n');
    for (const file of ['a.ts', 'b.ts']) writeFileSync(join(directory, file), source);
    const args = ['.', '--config', join(repository, '.jscpd.json'), '--baseline', join(directory, 'baseline.json'),
      '--output', join(directory, 'reports'), '--silent', '--fail-on-empty'];
    writeFileSync(join(directory, 'baseline.json'), '{"version":1,"fingerprints":{}}');
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', [...args, '--update-baseline'], directory).status, 0);
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 0);
    writeFileSync(join(directory, 'c.ts'), source);
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 1);
    rmSync(join(directory, 'c.ts'));
    const other = source.replaceAll('unique-quality-', 'new-quality-');
    for (const file of ['d.ts', 'e.ts']) writeFileSync(join(directory, file), other);
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('缩减重复基线后文档投影仍保持旧指纹并拦截新增重复', /** 使用真实 jscpd 验证基线缩减和后续重复检测。 */ () => {
  assert.equal(duplicationReference, '434486649908f91a7d8459ea59e7767d471a79a0');
  const directory = mkdtempSync(join(tmpdir(), 'clrn-projection-baseline-'));
  try {
    const makeSource = /** 构造可被 jscpd 识别的重复代码。
     * @param prefix - 区分两组历史代码的标记。 */ prefix => Array.from({ length: 14 },
      /** 生成一行测试代码。
       * @param _ - 未使用的数组元素。
       * @param index - 当前行号。 */ (_, index) => `console.log('${prefix}-${index}', input + ${index});`).join('\n');
    const old = makeSource('remaining');
    const removed = makeSource('removed');
    const projected = /** 模拟补充文档后的源码投影。
     * @param source - 原始源码。 */ source => projectJavascript(`/** 执行重复代码。 */\n${source}`, source, 'probe.ts');
    for (const [file, source] of [['a.ts', old], ['b.ts', old], ['d.ts', removed], ['e.ts', removed]]) {
      writeFileSync(join(directory, file), projected(source));
    }
    const baseline = join(directory, 'baseline.json');
    const args = ['.', '--config', join(repository, '.jscpd.json'), '--baseline', baseline,
      '--output', join(directory, 'reports'), '--silent', '--fail-on-empty'];
    writeFileSync(baseline, '{"version":1,"fingerprints":{}}');
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', [...args, '--update-baseline'], directory).status, 0);
    const before = JSON.parse(readFileSync(baseline, 'utf8')).fingerprints;
    rmSync(join(directory, 'd.ts'));
    rmSync(join(directory, 'e.ts'));
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', [...args, '--update-baseline'], directory).status, 0);
    const after = JSON.parse(readFileSync(baseline, 'utf8')).fingerprints;
    assert.ok(Object.keys(after).length > 0 && Object.keys(after).length < Object.keys(before).length);
    for (const [key, count] of Object.entries(after)) assert.equal(before[key], count);
    for (const file of ['a.ts', 'b.ts']) writeFileSync(join(directory, file), projected(old));
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 0);
    writeFileSync(join(directory, 'c.ts'), projected(old));
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 1);
    rmSync(join(directory, 'c.ts'));
    for (const file of ['d.ts', 'e.ts']) writeFileSync(join(directory, file), projected(makeSource('new')));
    assert.equal(invoke('node_modules/jscpd/run-jscpd.js', args, directory).status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Ruff C901 负例含 noqa 仍失败，实际复杂度为 12', /** 验证Ruff C901 负例含 noqa 仍失败，实际复杂度为 12。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-python-quality-'));
  try {
    const file = join(directory, 'probe.py');
    const branches = Array.from({ length: 11 }, /** 生成 Python 条件分支，验证新增复杂度违规不能沿用历史名额。
 * @param _ - 当前操作使用的 _。
 * @param n - 当前生成项的索引。 */ (_, n) => `    if value == ${n}:\n        return ${n}`).join('\n');
    writeFileSync(file, `def probe(value):  # noqa: C901\n${branches}\n    return -1\n`);
    const result = spawnSync('uvx', ['--from', 'ruff==0.15.12', 'ruff', 'check', '--isolated', '--no-cache',
      '--ignore-noqa', '--select', 'C901', '--config', 'lint.mccabe.max-complexity=10', '--output-format', 'json', file],
    { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(JSON.parse(result.stdout)[0].message, /12 > 10/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('统一入口拒绝新增 mock，整体禁用指令也不能绕过门禁', /** 验证统一入口拒绝新增 mock，整体禁用指令也不能绕过门禁。 */ () => {
  const directory = mkdtempSync(join(repository, '.quality-probe-'));
  try {
    const file = join(directory, 'probe.ts');
    writeFileSync(join(directory, 'invalid.ts'), 'export function (');
    for (const directive of ['', '/* eslint-disable */\n', '/* eslint complexity: off, "quality/no-quality-disable": off */\n']) {
      writeFileSync(file, `${directive}await page.route('**', handler);\n`);
      const result = invoke('scripts/quality.mjs', ['javascript'], repository);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /probe\.ts/);
      assert.match(result.stderr, /invalid\.ts:1:\d+ parse-error/);
      if (directive) assert.match(result.stderr, /quality\/no-quality-disable/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('真实代理适配器单测只使用已逐位置审查的例外', /** 验证真实代理适配器单测只使用已逐位置审查的例外。 */ async () => {
  const { findings } = JSON.parse(readFileSync(join(repository, 'quality/baseline.json'), 'utf8'));
  const file = 'e2e/helpers/mitmproxy-sources.test.ts';
  const [result] = await eslint.lintFiles([file]);
  const mock = result.messages.filter(/** 提取网络边界诊断，核对同一入口的重复出现次数。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'quality/no-network-response');
  assert.ok(mock.length > 0);
  const reviewed = findings.filter(/** 仅使用已审查的代理源适配器例外。
 * @param item - 历史诊断。 */ item => item.file === file
    && item.kind === 'adapter-unit' && item.reason.includes('代理源'));
  const current = mock.map(/** 使用门禁的源码指纹定位诊断，允许行号移动但不增加例外次数。
 * @param message - ESLint 诊断。 */ message => fingerprint({ file, rule: message.ruleId,
    line: message.line, message: message.message }, result.source));
  assert.deepEqual(newFindings(current, reviewed), []);
});
