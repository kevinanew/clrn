import { TSDocParser } from '@microsoft/tsdoc';

const parser = new TSDocParser();

/**
 * 从摘要树提取自然语言与行内代码，链接、标签和示例不提供用途正文。
 * @param node - TSDoc 摘要节点。
 * @param state - 跨摘要节点保存 HTML 链接的开闭状态。
 * @returns 可用于判断非空用途的文本。
 */
function summaryText(node, state = { link: false }) {
  if (node.kind.startsWith('Html')) {
    if (node.name.toLowerCase() === 'a') state.link = node.kind === 'HtmlStartTag' && !node.selfClosingTag;
    return '';
  }
  if (node.kind === 'PlainText') return state.link ? '' : node.text;
  if (node.kind === 'CodeSpan') return state.link ? '' : node.code;
  if (['LinkTag', 'InlineTag', 'FencedCode'].includes(node.kind)) return '';
  return node.getChildNodes().map(/** 收集子节点中的摘要正文。
 * @param child - 当前摘要子节点。 */ child => summaryText(child, state)).join(' ');
}

/** 去掉纯链接表示，防止 Markdown 链接和裸 URL 被当作用途正文。
 * @param text - 从摘要树提取的文本。
 * @returns 用于判断具体正文是否存在的剩余文字。 */
function withoutLinks(text) {
  return text.replace(/\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, '').replace(/https?:\/\/\S+/g, '');
}

/**
 * 读取节点前最后一条紧邻的文档块。
 * @param source - ESLint token 与源码接口。
 * @param node - 文档所描述的节点。
 * @returns 没有中间 token 的文档块。
 */
function adjacentDoc(source, node) {
  const comment = source.getCommentsBefore(node).at(-1);
  if (comment?.type !== 'Block' || !comment.value.startsWith('*')) return undefined;
  return source.text.slice(comment.range[1], node.range[0]).trim() ? undefined : comment;
}

/**
 * 定位实现自己的紧邻文档，允许声明容器，禁止向调用表达式或外层函数借用说明。
 * @param source - ESLint 源码及 token 信息。
 * @param node - 有实现体的函数节点。
 * @returns 紧邻该实现或其声明容器的文档注释。
 */
export function implementationDoc(source, node) {
  const direct = adjacentDoc(source, node);
  if (direct) return direct;
  let owner = node;
  const parent = node.parent;
  if (parent?.value === node) owner = parent;
  if (parent?.type === 'VariableDeclarator' && parent.init === node) {
    owner = parent;
    if (parent.parent.declarations.length === 1) owner = parent.parent;
  }
  if (['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(owner.parent?.type)) owner = owner.parent;
  return adjacentDoc(source, owner);
}

export default {
  meta: { type: 'problem', schema: [], messages: {
    missing: '每个函数实现必须有自己的紧邻 TSDoc 用途摘要。',
    empty: '用途摘要必须包含具体正文；空白、标签、链接和示例不能替代用途。',
    syntax: '{{message}}',
  } },
  /**
   * 为全部 TSDoc 块验证语法，并逐实现检查文档存在性和非空用途。
   * @param context - ESLint 当前文件的诊断上下文。
   * @returns 文档块和函数实现的 AST 访问器。
   */
  create(context) {
    const source = context.sourceCode;
    const parsed = new Map();
    /**
     * 验证一个有实现体的函数，声明与重载签名不计入实现。
     * @param node - 当前函数实现节点。
     */
    function check(node) {
      if (!node.body) return;
      const comment = implementationDoc(source, node);
      if (!comment) { context.report({ node, messageId: 'missing' }); return; }
      const doc = parsed.get(comment);
      if (!/[\p{L}\p{N}]/u.test(withoutLinks(summaryText(doc.docComment.summarySection)))) {
        context.report({ loc: comment.loc, messageId: 'empty' });
      }
    }
    return {
      /** 解析全部文档块，包含没有绑定到函数的类型、模块和类文档。 */
      Program() {
        for (const comment of source.getAllComments()) {
          if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
          const doc = parser.parseString(source.text.slice(...comment.range));
          parsed.set(comment, doc);
          for (const message of doc.log.messages) {
            context.report({ loc: comment.loc, messageId: 'syntax', data: { message: message.toString() } });
          }
        }
      },
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
