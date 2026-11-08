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
