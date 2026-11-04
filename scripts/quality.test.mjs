import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ESLint } from 'eslint';
import { assertShrinking, newFindings } from './quality-baseline.mjs';
import { repository } from './source-files.mjs';

const eslint = new ESLint({ cwd: repository });

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
  const branches = Array.from({ length: 10 }, /** 为当前索引构造`if (x === ${n}) return ${n};`。
 * @param _ - 当前操作使用的 _。
 * @param n - 当前生成项的索引。 */ (_, n) => `if (x === ${n}) return ${n};`).join('\n');
  assert.ok((await lint(`function probe(x: number) { ${branches} return -1; } probe(0);`))
    .some(/** 判断是否存在满足以下条件的条目：`item.ruleId === 'complexity'`。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'complexity'));
  assert.ok((await lint('function deep(x: boolean) { if(x) { if(x) { if(x) { if(x) { return 1; } } } } } deep(true);'))
    .some(/** 判断是否存在满足以下条件的条目：`item.ruleId === 'max-depth'`。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'max-depth'));
  const config = await eslint.calculateConfigForFile('e2e/helpers/scenario-proxy.ts');
  assert.deepEqual(config.rules.complexity, [2, { max: 10, variant: 'classic' }]);
  assert.deepEqual(config.rules['max-depth'], [2, 3]);
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
    assert.ok((await lint(source)).some(/** 判断是否存在满足以下条件的条目：`item.ruleId === 'quality/no-network-response'`。
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
  assert.equal(messages.filter(/** 仅保留满足以下条件的条目：`item.ruleId === 'quality/no-network-response'`。
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
    const names = new Set(summary.violations.map(/** 将当前条目映射为`item.rule.name`。
 * @param item - 当前遍历的条目。 */ item => item.rule.name));
    for (const name of ['no-cycles', 'ui-no-response-implementation', 'no-unresolved-local-imports']) assert.ok(names.has(name), name);
    assert.ok(summary.violations.some(/** 判断是否存在满足以下条件的条目：`item.type === 'reachability'`。
 * @param item - 当前遍历的条目。 */ item => item.type === 'reachability'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('真实 jscpd 的原生基线允许旧重复，阻止新内容及第三份历史副本', /** 验证真实 jscpd 的原生基线允许旧重复，阻止新内容及第三份历史副本。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-duplication-'));
  try {
    const source = Array.from({ length: 14 }, /** 为当前索引构造`console.log('unique-quality-${n}', ${n} + input);`。
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

test('Ruff C901 负例含 noqa 仍失败，实际复杂度为 12', /** 验证Ruff C901 负例含 noqa 仍失败，实际复杂度为 12。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-python-quality-'));
  try {
    const file = join(directory, 'probe.py');
    const branches = Array.from({ length: 11 }, /** 为当前索引构造`if value == ${n}:\n return ${n}`。
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
    for (const directive of ['', '/* eslint-disable */\n', '/* eslint complexity: off, "quality/no-quality-disable": off */\n']) {
      writeFileSync(file, `${directive}await page.route('**', handler);\n`);
      const result = invoke('scripts/quality.mjs', ['javascript'], repository);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /probe\.ts/);
      if (directive) assert.match(result.stderr, /quality\/no-quality-disable/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('真实代理适配器单测只使用已逐位置审查的例外', /** 验证真实代理适配器单测只使用已逐位置审查的例外。 */ async () => {
  const { findings } = JSON.parse(readFileSync(join(repository, 'quality/baseline.json'), 'utf8'));
  const file = 'e2e/helpers/mitmproxy-sources.test.ts';
  const [result] = await eslint.lintFiles([file]);
  const mock = result.messages.filter(/** 仅保留满足以下条件的条目：`item.ruleId === 'quality/no-network-response'`。
 * @param item - 当前遍历的条目。 */ item => item.ruleId === 'quality/no-network-response');
  assert.ok(mock.length > 0);
  for (const message of mock) {
    assert.ok(findings.some(/** 查找与代理源单测诊断对应的逐位置历史例外及其审查理由。
 * @param item - 当前遍历的条目。 */ item => item.file === file && item.line === message.line
      && item.rule === message.ruleId && item.kind === 'adapter-unit' && item.reason.includes('代理源')));
  }
});
