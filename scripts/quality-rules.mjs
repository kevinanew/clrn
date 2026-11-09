const responseMethods = new Set(['route', 'fulfill', 'routeFromHAR', 'routeWebSocket', 'mockServiceWorker', 'createServer']);

/**
 * 读取成员访问的静态属性名，覆盖可选链、字符串下标和模板常量。
 * @param node - ESTree 成员访问节点。
 * @returns 可确定的属性名。
 */
function propertyName(node) {
  if (!node.computed) return node.property.name;
  if (node.property.type === 'Literal') return node.property.value;
  if (node.property.type === 'TemplateLiteral' && node.property.expressions.length === 0) {
    return node.property.quasis[0].value.cooked;
  }
}

export default {
  rules: {
    'no-network-response': {
      meta: { type: 'problem', schema: [], messages: {
        response: 'TypeScript 网络响应入口 {{name}} 必须迁往 Python 代理；本机适配器单测须逐位置记录理由。',
      } },
      /**
       * 检查语法节点而非源码字符串；同时禁止提取成员作为别名后调用。
       * @param context - ESLint 当前文件的报告上下文。
       * @returns 需要访问的语法节点。
       */
      create(context) {
        const serverFactories = new Set();
        return {
          /**
           * 捕获直接调用、下标访问、bind/call/apply 和方法别名。
           * @param node - 当前成员访问。
           */
          MemberExpression(node) {
            const name = propertyName(node);
            if (responseMethods.has(name)) context.report({ node, messageId: 'response', data: { name } });
          },
          /**
           * 捕获解构提取，避免通过别名隐藏响应入口。
           * @param node - 当前对象解构模式。
           */
          ObjectPattern(node) {
            for (const property of node.properties) {
              if (property.type !== 'Property') continue;
              const name = property.computed ? property.key.value : property.key.name ?? property.key.value;
              if (responseMethods.has(name)) context.report({ node: property, messageId: 'response', data: { name } });
            }
          },
          /**
           * 禁止导入响应伪造库及 HTTP 后备服务器；端口探测的 net 模块不受影响。
           * @param node - 当前导入声明。
           */
          ImportDeclaration(node) {
            const name = node.source.value;
            const server = /^(?:node:)?https?2?$/.test(name)
              && node.specifiers.some(/** 识别 HTTP 服务工厂的具名导入，追踪后续响应入口调用。
 * @param specifier - 当前操作使用的 specifier。 */ specifier => specifier.imported?.name === 'createServer');
            if (server) {
              for (const specifier of node.specifiers) {
                if (specifier.imported?.name === 'createServer') serverFactories.add(specifier.local.name);
              }
            }
            if (server || /^(?:msw|nock|fetch-mock)(?:\/|$)/.test(name)) {
              context.report({ node, messageId: 'response', data: { name: server ? 'createServer' : name } });
            }
          },
          /**
           * 捕获浏览器全局网络接口替换，不限制正常 fetch 请求。
           * @param node - 当前赋值表达式。
           */
          AssignmentExpression(node) {
            const target = node.left;
            const name = target.type === 'Identifier' ? target.name
              : target.type === 'MemberExpression' ? propertyName(target) : undefined;
            if (['fetch', 'XMLHttpRequest', 'WebSocket'].includes(name)) {
              context.report({ node, messageId: 'response', data: { name } });
            }
          },
          /**
           * 捕获 Node mock、Sinon 与 Jest 等通过字符串属性名替换网络方法的调用。
           * @param node - 当前方法替换调用。
           */
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && serverFactories.has(node.callee.name)) {
              context.report({ node, messageId: 'response', data: { name: 'createServer' } });
              return;
            }
            if (node.callee.type !== 'MemberExpression') return;
            if (!['method', 'replace', 'stub', 'spyOn'].includes(propertyName(node.callee))) return;
            const name = node.arguments[1]?.value;
            if (responseMethods.has(name) || ['fetch', 'XMLHttpRequest', 'WebSocket'].includes(name)) {
              context.report({ node, messageId: 'response', data: { name } });
            }
          },
        };
      },
    },
    'no-quality-disable': {
      meta: { type: 'problem', schema: [], messages: { disable: '质量规则禁用必须经规则配置审查，不能用行内指令绕过迁移清单。' } },
      /**
       * 审查 ESLint 指令，保留无关规则已有的精确例外。
       * @param context - ESLint 当前文件的报告上下文。
       * @returns 文件级指令检查器。
       */
      create(context) {
        return {
          /** 检查注释中的规则禁用指令。 */
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const directive = comment.value.trim().split('--')[0].trim();
              if (!/^eslint(?:\s|-(?:disable|enable))/.test(directive)) continue;
              const rules = directive.replace(/^eslint(?:-(?:disable|enable)(?:-next-line|-line)?)?\s*/, '');
              if (!rules || /(?:complexity|max-depth|quality\/)/.test(rules)) {
                context.report({ loc: comment.loc, messageId: 'disable' });
              }
            }
          },
        };
      },
    },
  },
};
