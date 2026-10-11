/**
 * 只归一 React Navigation 已观测到的 4px 抖动；更大的位移属于视觉回归。
 * @param declaration - 元素当前内联 translate 样式值。
 */
export function appliedGameTranslation(declaration: string): number {
  const value = declaration.trim();
  if (!value || value === '0' || value === '0px') return 0;
  const match = /^0(?:px)?\s+(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!match) throw new Error(`牌桌已有未知 translate: ${value}`);
  return Number(match[1]);
}

/**
 * 结合已施加的位移计算牌桌对齐量，拒绝超出允许范围的页面偏移。
 * @param measuredTop - 牌桌当前相对视口的纵坐标。
 * @param appliedTranslation - 此前已经施加的纵向位移。
 */
export function gameViewportCorrection(measuredTop: number, appliedTranslation: number): number {
  const unadjustedTop = measuredTop - appliedTranslation;
  if (!Number.isFinite(unadjustedTop) || Math.abs(unadjustedTop) > 4) {
    throw new Error(`德州牌桌超出可归一的视口偏移：${unadjustedTop}px`);
  }
  return -unadjustedTop;
}
