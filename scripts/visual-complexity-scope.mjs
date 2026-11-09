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

/** Issue 104 的业务场景及测试辅助实现，全部采用测试预算。 */
export const visualCaseSupportFiles = [
  'visual/cases/_shared/room.test.ts',
  'visual/cases/_shared/room.ts',
  'visual/cases/account/account.spec.ts',
  'visual/cases/account/presentation.ts',
  'visual/cases/account/scenarios.ts',
  'visual/cases/auth/auth.spec.ts',
  'visual/cases/auth/scenarios.ts',
  'visual/cases/club/club.spec.ts',
  'visual/cases/club/guest.ts',
  'visual/cases/club/guestReadiness.ts',
  'visual/cases/club/proxy.ts',
  'visual/cases/club/scenarios.ts',
  'visual/cases/club/searchResult.ts',
  'visual/cases/game-record/details.ts',
  'visual/cases/game-record/game-record.spec.ts',
  'visual/cases/game-record/matrix.test.ts',
  'visual/cases/game-record/proxy.ts',
  'visual/cases/game-record/scenarios.ts',
  'visual/cases/game-record/ui.ts',
  'visual/cases/hall/guest.ts',
  'visual/cases/hall/hall.spec.ts',
  'visual/cases/hall/scenarios.ts',
  'visual/cases/help/help.spec.ts',
  'visual/cases/help/scenarios.ts',
  'visual/cases/launch/launch.spec.ts',
  'visual/cases/message/message.spec.ts',
  'visual/cases/message/scenarios.ts',
  'visual/cases/private-room/presentation.ts',
  'visual/cases/private-room/private-room.spec.ts',
  'visual/cases/private-room/scenarios.ts',
  'visual/cases/runScenario.ts',
  'visual/cases/texas-holdem/controlVariants.ts',
  'visual/cases/texas-holdem/gameplay.ts',
  'visual/cases/texas-holdem/hall.ts',
  'visual/cases/texas-holdem/hallVariants.ts',
  'visual/cases/texas-holdem/panelVariants.ts',
  'visual/cases/texas-holdem/panels.ts',
  'visual/cases/texas-holdem/proxy.ts',
  'visual/cases/texas-holdem/records.ts',
  'visual/cases/texas-holdem/renderingChecks.ts',
  'visual/cases/texas-holdem/replay.ts',
  'visual/cases/texas-holdem/replayData.ts',
  'visual/cases/texas-holdem/room.ts',
  'visual/cases/texas-holdem/roomCleanup.test.ts',
  'visual/cases/texas-holdem/roomEntry.test.ts',
  'visual/cases/texas-holdem/scenarios.ts',
  'visual/cases/texas-holdem/tableVariants.ts',
  'visual/cases/texas-holdem/texas-holdem.spec.ts',
  'visual/cases/texas-holdem/variantSupport.ts',
  'visual/cases/texas-holdem/viewportAlignment.test.ts',
  'visual/cases/texas-holdem/viewportAlignment.ts',
  'visual/cases/wallet/scenarios.ts',
  'visual/cases/wallet/transactionReadiness.ts',
  'visual/cases/wallet/transactions.ts',
  'visual/cases/wallet/wallet.spec.ts',
  'visual/cases/zhajinhua/capture.ts',
  'visual/cases/zhajinhua/gameplay.ts',
  'visual/cases/zhajinhua/preGame.ts',
  'visual/cases/zhajinhua/proxy.ts',
  'visual/cases/zhajinhua/replayData.ts',
  'visual/cases/zhajinhua/scenarios.ts',
  'visual/cases/zhajinhua/zhajinhua.spec.ts',
];

/** 覆盖范围内所有相邻测试与新提取模块。 */
export const visualCasePatterns = ['visual/cases/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];

/**
 * 业务场景目录中的所有 JS/TS 实现均参与门禁。
 * @param files - 当前源码候选路径。
 * @returns 业务场景及辅助文件。
 */
export function visualCaseFiles(files) {
  return files.filter(/** 匹配完整业务场景目录。
   * @param file - 源码路径。 */ file => /^visual\/cases\/.*\.[cm]?[jt]sx?$/.test(file));
}
