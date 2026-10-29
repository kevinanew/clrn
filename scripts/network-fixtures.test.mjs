import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { repository, sourceFiles } from './source-files.mjs';

test('应用集成与视觉场景不能重新引入 TypeScript 响应路由或后备服务器', () => {
  const files = sourceFiles().filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')
    && /^(?:visual\/(?:cases|animations|src)\/|e2e\/(?:interactions|helpers)\/)/.test(file)
    && !file.endsWith('.browser.ts'));
  assert.ok(files.length > 100, '必须扫描实际场景及公共辅助代码');
  const violations = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(path.join(repository, file), 'utf8'), ts.ScriptTarget.Latest, true);
    /**
     * 遍历实际调用和导入，避免注释或断言文字触发误报。
     * @param node - 待检查的语法节点。
     */
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ['route', 'fulfill', 'routeWebSocket', 'routeFromHAR'].includes(node.expression.name.text)) {
        violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
      }
      // 唯一的端口探测服务属于代理进程管理，不生成任何应用响应。
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'node:http'
          && node.importClause?.namedBindings?.getText(source).includes('createServer')) {
        violations.push(`${file}: 不允许响应桥接服务器`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, []);
});
