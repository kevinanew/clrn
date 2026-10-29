import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { Mitmproxy } from './mitmproxy-client';
import { bindScenarioProxy, scenarioProxy, selectScenario } from './scenario-proxy';

test('共用场景客户端不依赖调用方之外的 Playwright 安装', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-scenario-types-'));
  const require = createRequire(import.meta.url);
  try {
    for (const file of ['scenario-proxy.ts', 'mitmproxy-client.ts']) {
      copyFileSync(path.join(__dirname, file), path.join(directory, file));
    }
    // 临时目录中只有共用客户端；仅提供 Node.js 类型，不能借用仓库中的 Playwright。
    const program = ts.createProgram([path.join(directory, 'scenario-proxy.ts')], {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      strict: true, noEmit: true, skipLibCheck: true, types: ['node'],
      typeRoots: [path.dirname(path.dirname(require.resolve('@types/node/package.json')))],
    });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(item =>
      ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], '单独安装视觉依赖时共用客户端必须能编译');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('场景代理按上下文身份隔离，未绑定的上下文立即失败', async () => {
  const first = {}, second = {}, unbound = {};
  const firstProxy = new Mitmproxy(1, 'test-only');
  const secondProxy = new Mitmproxy(2, 'test-only');
  const commands: unknown[] = [];
  firstProxy.command = /**
   * 捕获场景命令，不启动网络服务。
   * @param endpoint - 场景控制路径。
   * @param payload - 具名场景和账号标识。
   */ async <T>(endpoint: string, payload?: unknown): Promise<T> => {
    commands.push({ endpoint, payload });
    return {} as T;
  };
  bindScenarioProxy(first, firstProxy);
  bindScenarioProxy(second, secondProxy);
  assert.equal(scenarioProxy(first), firstProxy);
  assert.equal(scenarioProxy(second), secondProxy);
  assert.throws(() => scenarioProxy(unbound), /当前上下文未绑定 Python 场景代理/);
  await selectScenario(first, 'pagination', { userId: '本轮账号' });
  assert.deepEqual(commands, [{ endpoint: 'fixtures/select', payload: { name: 'pagination', userId: '本轮账号' } }]);
});
