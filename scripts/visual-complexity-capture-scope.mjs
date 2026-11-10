/** Issue 102：动画采集、场景准备及全部同名前缀辅助实现均采用测试上限 3。 */
export const captureSupportFiles = [
  'visual/animations/ambient.spec.ts',
  'visual/animations/appSession.ts',
  'visual/animations/application.spec.ts',
  'visual/animations/baseline-inventory.test.mjs',
  'visual/animations/bottomSheetScroll.browser.ts',
  'visual/animations/bottomSheetScroll.ts',
  'visual/animations/captureTypes.ts',
  'visual/animations/cardSpriteClock.browser.ts',
  'visual/animations/cardSpriteClock.ts',
  'visual/animations/cardSpriteClockRegression.ts',
  'visual/animations/cardSpriteClockState.browser.ts',
  'visual/animations/cardSpriteClockState.ts',
  'visual/animations/cardSpriteControl.config.ts',
  'visual/animations/cardSpriteControl.spec.ts',
  'visual/animations/cardSpriteDiagnostics.browser.ts',
  'visual/animations/cardSpriteDiagnostics.ts',
  'visual/animations/cardSpriteHistory.browser.ts',
  'visual/animations/cardSpriteImageState.test.ts',
  'visual/animations/cardSpriteImageState.ts',
  'visual/animations/cardSpriteLifecycle.test.ts',
  'visual/animations/cardSpriteLifecycle.ts',
  'visual/animations/cardSpriteLoader.browser.ts',
  'visual/animations/cardSpriteLoader.ts',
  'visual/animations/cardSpritePrivacy.test.ts',
  'visual/animations/cardSpritePrivacy.ts',
  'visual/animations/cardSpriteReadiness.browser.ts',
  'visual/animations/cardSpriteReadiness.ts',
  'visual/animations/collection.test.ts',
  'visual/animations/dialogs.spec.ts',
  'visual/animations/imageFrames.ts',
  'visual/animations/leaderboardReadiness.browser.ts',
  'visual/animations/leaderboardReadiness.ts',
  'visual/animations/networkClock.test.ts',
  'visual/animations/networkClock.ts',
  'visual/animations/numericMask.ts',
  'visual/animations/playerAnimationAsset.browser.ts',
  'visual/animations/playerAnimationAsset.ts',
  'visual/animations/playerProfileReadiness.browser.ts',
  'visual/animations/playerProfileReadiness.ts',
  'visual/animations/playwright.config.ts',
  'visual/animations/popups.browser.ts',
  'visual/animations/popups.ts',
  'visual/animations/readinessTestHelpers.ts',
  'visual/animations/renderReadiness.browser.ts',
  'visual/animations/renderReadiness.ts',
  'visual/animations/renewReadiness.browser.ts',
  'visual/animations/renewReadiness.ts',
  'visual/animations/roomPreflight.test.ts',
  'visual/animations/roomPreflight.ts',
  'visual/animations/run.ts',
  'visual/animations/screenshotComparison.test.ts',
  'visual/animations/screenshotComparison.ts',
  'visual/animations/search-prompt.spec.ts',
  'visual/animations/skeleton.spec.ts',
  'visual/animations/slot.spec.ts',
  'visual/animations/slotBannerPreparation.browser.ts',
  'visual/animations/slotBannerPreparation.ts',
  'visual/animations/slotPopups.spec.ts',
  'visual/animations/slotWallet.ts',
  'visual/animations/tableConnection.browser.ts',
  'visual/animations/tablePanels.ts',
  'visual/animations/tableSession.ts',
  'visual/animations/texas.spec.ts',
  'visual/animations/texasAssets.ts',
  'visual/animations/texasFeedback.ts',
  'visual/animations/texasGameplay.ts',
  'visual/animations/texasHall.ts',
  'visual/animations/texasSocial.ts',
  'visual/animations/zhajinhua.spec.ts',
  'visual/animations/zhajinhuaFeedback.ts',
  'visual/animations/zhajinhuaGameplay.ts'
];

const stems = [...new Set(captureSupportFiles.map(moduleStem))];
export const captureSupportPatterns = stems.flatMap(/** 同时约束相邻测试与拆出目录。
 * @param stem - 原始模块前缀。 */ stem => [
  `${stem}*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
  `${stem}*/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
]);

/**
 * 提取原模块的公共前缀，支持全部 JS/TS 扩展名。
 * @param file - 原模块路径。
 * @returns 用于覆盖相邻实现的路径前缀。
 */
function moduleStem(file) { return file.replace(/(?:\.(?:test|spec|browser|config))?\.[cm]?[jt]sx?$/, ''); }

/**
 * 列出全部采集辅助实现，不能因没有测试后缀而放宽预算。
 * @param files - 当前仓库源码候选路径。
 * @returns Issue 102 的实际扫描范围。
 */
export function captureFiles(files) {
  return files.filter(/** 仅选择对应模块的 JS/TS 源码。
   * @param file - 当前源码路径。 */ file => /\.[cm]?[jt]sx?$/.test(file) && stems.some(/** 覆盖同名前缀的提取实现。
    * @param stem - 原模块前缀。 */ stem => file.startsWith(stem)));
}
