import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { repository, sourceFiles } from './source-files.mjs';

/**
 * 识别唯一允许的注册防写路由，不放行任何响应夹具。
 * @param file - 当前源码路径。
 * @param node - 已确认为属性调用的语法节点。
 * @returns 是否为确切的注册阻断调用。
 */
function isRegistrationGuard(file, node) {
  if (file !== 'e2e/cases/_shared/auth.ts' || node.expression.name.text !== 'route') return false;
  const [pattern, handler] = node.arguments;
  if (!pattern || !ts.isStringLiteral(pattern) || pattern.text !== '**/public/v11/user/register/**') return false;
  return Boolean(handler && ts.isArrowFunction(handler) && isBlockedAbort(handler.body));
}

/**
 * 检查处理器是否仅以指定原因中止请求。
 * @param body - 路由箭头函数的函数体。
 * @returns 是否为单参数 blockedbyclient 中止调用。
 */
function isBlockedAbort(body) {
  if (!ts.isCallExpression(body) || !ts.isPropertyAccessExpression(body.expression)) return false;
  const [reason] = body.arguments;
  return body.expression.name.text === 'abort' && body.arguments.length === 1
    && ts.isStringLiteral(reason) && reason.text === 'blockedbyclient';
}

test('应用集成与视觉场景不能重新引入 TypeScript 响应路由或后备服务器', () => {
  const files = sourceFiles().filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')
    && /^(?:visual\/(?:cases|animations|src)\/|e2e\/(?:cases|interactions|helpers)\/)/.test(file)
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
        if (!isRegistrationGuard(file, node)) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
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
