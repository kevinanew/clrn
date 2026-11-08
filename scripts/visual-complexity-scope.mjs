/** 视觉测试与辅助实现；独立工具单列，避免按文件后缀放宽预算。 */
export const visualSupportFiles = [
  'visual/scenarioScope.ts',
  'visual/docker-env.test.ts',
  'visual/run-visual-config.test.ts',
  'visual/run-visual-config.ts',
  'visual/run-visual-isolation.test.ts',
  'visual/run-visual.ts',
  'visual/scenarioPages.test.ts',
  'visual/scenarioTypes.ts',
  'visual/scenarios.test.ts',
  'visual/scenarios.ts',
  'visual/screenshotComparisonConfiguration.test.ts',
  'visual/screenshotComparisonConfiguration.ts',
  'visual/snapshotLocations.test.ts',
  'visual/snapshotPolicy.browser.ts',
  'visual/target.test.ts',
  'visual/target.ts',
  'visual/test-account.test.ts',
  'visual/test-account.ts',
  'visual/visual-suite.test.ts',
  'visual/visual-suite.ts',
  'visual/tests/accountPresentation.spec.ts',
  'visual/tests/authValidation.spec.ts',
  'visual/tests/cardSpriteReadiness.spec.ts',
  'visual/tests/guestClubReadiness.spec.ts',
  'visual/tests/localImages.spec.ts',
  'visual/tests/preparePage.spec.ts',
  'visual/tests/privateRoomPresentation.spec.ts',
  'visual/tests/texas-rendering.spec.ts',
  'visual/tests/tutorials.spec.ts',
  'visual/tests/walletTransactionReadiness.spec.ts',
];

export const visualToolFiles = ['visual/open-report.ts', 'visual/playwright.config.ts'];
export const visualCheckFiles = ['scripts/visual-complexity*.mjs'];

const visualModuleStems = [...new Set([...visualSupportFiles, ...visualToolFiles].map(moduleStem))];
export const visualSupportPatterns = visualModuleStems.flatMap(/** 覆盖同名前缀的模块、相邻测试及目录内所有后代实现。
 * @param stem - 不含测试后缀与扩展名的模块路径。 */ stem => [
  `${stem}*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
  `${stem}*/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
]);
export const visualCheckSupportFiles = ['scripts/visual-complexity-fixture.mjs', 'scripts/visual-complexity*.test.mjs'];

/**
 * 从显式文件清单取得模块前缀，不按测试后缀放宽辅助实现。
 * @param file - 原始模块或相邻测试路径。
 * @returns 同名模块的公共前缀。
 */
function moduleStem(file) { return file.replace(/(?:\.(?:test|spec|browser))?\.ts$/, ''); }

/**
 * 自动纳入同名前缀的新模块，独立工具仍只使用显式清单。
 * @param files - 当前源码候选路径。
 * @returns 视觉入口范围的实际文件。
 */
export function visualEntryFiles(files) {
  return files.filter(/** 仅扫描本范围前缀的 JS/TS 源码。
   * @param file - 当前源码路径。 */ file => /\.[cm]?[jt]sx?$/.test(file) && visualModuleStems.some(/** 匹配原模块前缀。
    * @param stem - 原模块公共前缀。 */ stem => file.startsWith(stem)));
}

/** Issue 103 的原始文件必须存在，相邻测试及提取模块按同名前缀全量覆盖。 */
export const animationSupportFiles = [
  'visual/animations/timeline.browser.ts',
  'visual/animations/timeline.ts',
  'visual/animations/timelineComparison.ts',
  'visual/animations/timelineRegression.ts',
  'visual/animations/walletMask.browser.ts',
  'visual/animations/walletMaskRegression.ts',
];
export const animationSupportPatterns = ['visual/animations/timeline*.ts', 'visual/animations/walletMask*.ts'];

/**
 * 将相邻测试及新提取模块纳入相同测试预算。
 * @param files - 当前源码候选路径。
 * @returns 本范围实际文件。
 */
export function animationFiles(files) {
  return files.filter(/** 根据同名前缀覆盖完整动画辅助模块。
   * @param file - 当前源码路径。 */ file => /^visual\/animations\/(?:timeline|walletMask).*\.ts$/.test(file));
}
