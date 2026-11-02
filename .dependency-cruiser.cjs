/** 禁止循环及界面操作层读取响应实现；代理控制客户端只传递逻辑场景。 */
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'ui-no-response-implementation', severity: 'error',
      from: { path: '^(e2e/(cases|interactions|helpers)/|visual/(cases|animations|src|tests)/)' },
      to: {
        reachable: true,
        path: '(^e2e/mitmproxy/|^visual/cases/[^/]+/mitmproxy/|(^|/)network-responses/|^scripts/account-network-fixture\\.mjs$)',
        // 两端共用的脱敏逻辑标识表是数据，不含响应实现和实际连接信息。
        pathNot: '^e2e/mitmproxy/data/diagnostic-paths\\.json$',
      },
    },
    {
      name: 'no-unresolved-local-imports', severity: 'error', from: {},
      to: { couldNotResolve: true, path: '^\\.{1,2}/|^/' },
    },
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)(node_modules|\\.venv|test-results|playwright-report|blob-report|snapshots|__pycache__|\\.ttyctl)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
