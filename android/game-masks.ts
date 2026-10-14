import type { NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 从实际原生树取得弹层内容；半透明全屏触摸层本身不能遮住背景动画。
 * @param nodes - 保留父子关系的可见节点。
 */
export function foregroundPanels(nodes: NativeNode[]): NativeNode[] {
  return nodes.flatMap(node => node.children?.some(child => child.res === 'screen-mask-touch-to-close')
    ? node.children.filter(child => child.res !== 'screen-mask-touch-to-close'
      && child.bounds.width > 80 && child.bounds.height > 80) : [])
    .concat(nodes.filter(node => node.res === 'in-game-chat-animated-view'));
}

/**
 * 将背景动态区域裁剪到前景矩形以外，不遮掉面板内的文字、按钮或牌面。
 * @param mask - 需要排除的背景动画或动态文字。
 * @param panel - 覆盖在其上的实际面板边界。
 */
export function subtractPanel(mask: ScreenshotMask, panel: ScreenshotBounds): ScreenshotMask[] {
  const left = Math.max(mask.x, panel.x);
  const top = Math.max(mask.y, panel.y);
  const right = Math.min(mask.x + mask.width, panel.x + panel.width);
  const bottom = Math.min(mask.y + mask.height, panel.y + panel.height);
  if (right <= left || bottom <= top) return [mask];
  return [
    { ...mask, height: top - mask.y },
    { ...mask, y: bottom, height: mask.y + mask.height - bottom },
    { ...mask, y: top, width: left - mask.x, height: bottom - top },
    { ...mask, x: right, y: top, width: mask.x + mask.width - right, height: bottom - top },
  ].filter(part => part.width > 0 && part.height > 0);
}

/**
 * 仅裁掉覆盖当前节点的面板；面板自己的动态房号仍须排除。
 * @param mask - 当前节点对应的动态区域。
 * @param source - 对应的原生控件。
 * @param panels - 当前前景内容节点。
 */
export function visibleMasks(mask: ScreenshotMask, source: NativeNode, panels: NativeNode[]): ScreenshotMask[] {
  /**
   * 判断节点是否属于当前前景，避免裁掉它自己的动态文字。
   * @param parent - 当前检查的前景节点。
   */
  const contains = (parent: NativeNode): boolean => parent === source || Boolean(parent.children?.some(contains));
  return panels.filter(panel => !contains(panel))
    .reduce((parts, panel) => parts.flatMap(part => subtractPanel(part, panel.bounds)), [mask]);
}
