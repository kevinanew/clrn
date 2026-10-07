/** 只归一 React Navigation 已观测到的 4px 抖动；更大的位移属于视觉回归。 */
export function appliedGameTranslation(declaration: string): number {
  const value = declaration.trim();
  if (!value || value === '0' || value === '0px') return 0;
  const match = /^0(?:px)?\s+(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!match) throw new Error(`牌桌已有未知 translate: ${value}`);
  return Number(match[1]);
}

export function gameViewportCorrection(measuredTop: number, appliedTranslation: number): number {
  const unadjustedTop = measuredTop - appliedTranslation;
  if (!Number.isFinite(unadjustedTop) || Math.abs(unadjustedTop) > 4) {
    throw new Error(`德州牌桌超出可归一的视口偏移：${unadjustedTop}px`);
  }
  return -unadjustedTop;
}
