import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { repository, sourceFiles } from './source-files.mjs';

/** 识别唯一允许的注册防写路由，不放行响应夹具。
 * @param file - 当前源码路径。
 * @param node - 已确认的属性调用。 */
function isRegistrationGuard(file, node) {
  if (file !== 'e2e/cases/_shared/auth.ts' || node.expression.name.text !== 'route') return false;
  return registrationArguments(node.arguments);
}

/** 路由必须使用精确注册模式和只执行阻断的箭头处理器。
 * @param args - 路由调用参数。 */
function registrationArguments([pattern, handler]) {
  if (!literalEquals(pattern, '**/public/v11/user/register/**')) return false;
  return blockingHandler(handler);
}

/** 安全核对字符串字面量，缺失节点直接拒绝。
 * @param node - 可选语法节点。
 * @param value - 精确预期文本。 */
function literalEquals(node, value) {
  if (!node) return false;
  return ts.isStringLiteral(node) && node.text === value;
}

/** 处理器必须是箭头函数且只有固定 abort 表达式。
 * @param handler - 路由处理器。 */
function blockingHandler(handler) {
  if (!handler) return false;
  return ts.isArrowFunction(handler) && isBlockedAbort(handler.body);
}

/** 识别属性调用后核对 abort 名称与单参数。
 * @param body - 路由箭头函数体。 */
function isBlockedAbort(body) {
  if (!propertyCall(body)) return false;
  return exactBlockedAbort(body);
}

/** 只有精确 blockedbyclient 调用可作为写入保护。
 * @param body - 属性调用表达式。 */
function exactBlockedAbort(body) {
  return [body.expression.name.text === 'abort', body.arguments.length === 1,
    literalEquals(body.arguments[0], 'blockedbyclient')].every(Boolean);
}

/** 识别属性访问形式的调用。
 * @param node - 当前语法节点。 */
function propertyCall(node) { return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression); }

/** 选择原有业务范围，排除独立测试和浏览器工具。
 * @param file - 源码路径。 */
function scenarioSource(file) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) return false;
  return scenarioPath(file);
}

/** 维持原有场景目录和浏览器模块排除范围。
 * @param file - 源码路径。 */
function scenarioPath(file) {
  return /^(?:visual\/(?:cases|animations|src)\/|e2e\/(?:cases|interactions|helpers)\/)/.test(file) && !file.endsWith('.browser.ts');
}

/** 识别受约束的响应路由属性调用。
 * @param node - 当前语法节点。 */
function responseRoute(node) {
  return propertyCall(node) && ['route', 'fulfill', 'routeWebSocket', 'routeFromHAR'].includes(node.expression.name.text);
}

/** 只识别 node:http 的导入声明。
 * @param node - 当前语法节点。 */
function httpImport(node) { return ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'node:http'; }

/** 捕获 HTTP 导入中的服务器工厂。
 * @param node - 当前语法节点。
 * @param source - 完整源码节点。 */
function responseServer(node, source) {
  if (!httpImport(node)) return false;
  return importedServerBinding(node.importClause, source);
}

/** 按原有语法边界记录路由和后备服务器违规。
 * @param node - 当前节点。
 * @param file - 当前源码路径。
 * @param source - 完整源码节点。
 * @param violations - 累积违规。 */
function inspectNode(node, file, source, violations) {
  inspectRoute(node, file, source, violations);
  if (responseServer(node, source)) violations.push(`${file}: 不允许响应桥接服务器`);
}

/** 保留唯一注册阻断例外及准确行号。
 * @param node - 当前节点。
 * @param file - 当前源码路径。
 * @param source - 完整源码节点。
 * @param violations - 累积违规。 */
function inspectRoute(node, file, source, violations) {
  if (!responseRoute(node)) return;
  if (!isRegistrationGuard(file, node)) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
}

test('应用集成与视觉场景不能重新引入 TypeScript 响应路由或后备服务器', /** 扫描实际调用与导入，排除注释和断言文字的误报。 */ () => {
  const files = sourceFiles().filter(scenarioSource);
  assert.ok(files.length > 100, '必须扫描实际场景及公共辅助代码');
  const violations = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(path.join(repository, file), 'utf8'), ts.ScriptTarget.Latest, true);
    /** 遍历完整语法树，包含所有嵌套回调。
     * @param node - 当前语法节点。 */
    function visit(node) {
      inspectNode(node, file, source, violations);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, []);
});

/** 核对可选导入子句中的命名绑定。
 * @param clause - 可选导入子句。
 * @param source - 完整源码节点。 */
function importedServerBinding(clause, source) { return clause?.namedBindings?.getText(source).includes('createServer'); }
