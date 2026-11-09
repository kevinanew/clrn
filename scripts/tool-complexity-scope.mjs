/** Issue 99 原始文件；缺失文件不能让门禁空跑。 */
export const toolScopeFiles = [
  '.dependency-cruiser.cjs', 'eslint.config.mjs', 'lint-lines.mjs',
  ...[
    'account-network-fixture.mjs', 'ci-accounts.mjs', 'ci-accounts.test.mjs',
    'configure-ci-account.mjs', 'connection-diagnostic-summary.mjs', 'creation-account-diagnostics.test.mjs',
    'lint-shell.mjs', 'lint.test.mjs', 'network-fixtures.test.mjs', 'plan-ci-accounts.mjs',
    'prepare-release-web.mjs', 'prepare-test-account-rooms.mjs', 'prepare-test-account-rooms.test.mjs',
    'prepare-test-account.mjs', 'prepare-test-account.test.mjs', 'quality-baseline.mjs',
    'quality-lint.mjs', 'quality-rules.mjs', 'quality.mjs', 'quality.test.mjs',
    'release-connection.test.mjs', 'release-diagnostics.mjs', 'release-diagnostics.test.mjs',
    'release-stream.test.mjs', 'release-web-server.mjs', 'release-web.test.mjs',
    'request-failure-playwright.test.mjs', 'request-failure.cjs', 'request-failure.d.cts',
    'request-failure.test.mjs', 'source-files.mjs', 'staging-deployment.mjs',
    'staging-deployment.test.mjs', 'test-local.mjs', 'with-release-web-server.mjs',
    'with-test-account.mjs', 'with-test-account.test.mjs',
  ].map(/** 转为仓库相对路径。
   * @param file - scripts 下的文件名。 */ file => `scripts/${file}`),
];

/** 仅独立通用工具采用 6；账号、发布测试生命周期和诊断仍采用 3。 */
export const generalToolFiles = [
  '.dependency-cruiser.cjs', 'eslint.config.mjs', 'lint-lines.mjs',
  'scripts/lint-shell.mjs', 'scripts/quality-baseline.mjs', 'scripts/quality-lint.mjs',
  'scripts/quality-rules.mjs', 'scripts/quality.mjs', 'scripts/source-files.mjs',
  'scripts/tool-complexity.mjs', 'scripts/tool-complexity-scope.mjs',
];

const stems = [...new Set(toolScopeFiles.map(/** 同名前缀覆盖相邻测试与提取模块。
 * @param file - 原始路径。 */ file => file.replace(/(?:\.test)?\.(?:mjs|cjs|d\.cts)$/, '')))];
export const toolSupportPatterns = [...stems, 'scripts/tool-complexity'].flatMap(/** 同时覆盖平铺模块与子目录。
 * @param stem - 模块路径前缀。 */ stem => [
  `${stem}*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
  `${stem}*/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
]);

/**
 * 从 Git 源码列表选择完整范围，不以 test 后缀判断辅助实现。
 * @param files - 仓库源码候选路径。
 * @returns 本范围实际文件。
 */
export function scopedToolFiles(files) {
  return files.filter(/** 收集原模块、门禁及同名前缀的新模块。
   * @param file - 源码路径。 */ file => /\.[cm]?[jt]sx?$/.test(file) && [...stems, 'scripts/tool-complexity'].some(
    /** 判断模块前缀。
     * @param stem - 原始模块前缀。 */ stem => file.startsWith(stem)));
}
