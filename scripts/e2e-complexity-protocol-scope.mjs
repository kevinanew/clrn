/** Issue 101 的协议、诊断与交互范围，含原有配置及相邻回归测试。 */
export const protocolSupportFiles = [
  ...['fixtures', 'freshchat.spec', 'gestures', 'pagination-diagnostics.browser', 'pagination-diagnostics',
    'pagination.spec', 'scroll-and-controls.spec', 'settings-scroll.spec'].map(/** 列出原有交互用例及辅助。
     * @param name - 模块名。 */ name => `e2e/interactions/${name}.ts`),
  'e2e/interactions/pagination-observer.browser.js',
  'e2e/freshchat.config.ts', 'e2e/interactions.config.ts', 'e2e/playwright.config.ts',
  'e2e/mitmproxy.spec.ts', 'e2e/network-resilience.spec.ts', 'e2e/public-artifacts.spec.ts',
  'e2e/sites-availability.spec.ts', 'e2e/staging-notice.spec.ts', 'e2e/test-sign-in-notices.spec.ts',
  'e2e/test-user.spec.ts', 'e2e/test-wallet-statements.spec.ts', 'e2e/test-wallet.spec.ts',
  ...['assertions', 'connection-diagnostics.browser', 'diagnostic-persistence.test', 'diagnostic-privacy',
    'diagnostic-recorder.test', 'diagnostic-recorder', 'diagnostic-summary', 'environment', 'mitmproxy-client', 'mitmproxy-process',
    'mitmproxy-session', 'mitmproxy-metadata', 'mitmproxy-sources.test', 'mitmproxy-sources', 'mitmproxy', 'network-fixture', 'page',
    'public-source-maps.test', 'public-source-maps', 'scenario-proxy.test', 'scenario-proxy', 'sites',
    'staging-notice', 'tutorials', 'web-target', 'web-target.test'].map(/** 组成原有辅助模块的精确路径。
     * @param name - 模块名。 */ name => `e2e/helpers/${name}.ts`),
];

// 这些既有独立诊断模块由其他任务维护；新文件没有这项排除，不能将提取实现移出扫描。
export const existingOtherDiagnosticFiles = [
  'browser-diagnostics', 'ci-diagnostics.browser', 'diagnostic-attachments.test', 'diagnostic-fixture',
  'diagnostic-log.test', 'diagnostic-log', 'diagnostic-reporter.test', 'diagnostic-reporter', 'diagnostic-test',
].map(/** 只列出任务开始时已存在的其他诊断模块。
 * @param name - 模块名。 */ name => `e2e/helpers/${name}.ts`);

export const protocolSupportPatterns = [
  ...protocolSupportFiles,
  'e2e/helpers/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  'e2e/interactions/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];
