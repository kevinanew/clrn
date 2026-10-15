import type { NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 根据前景就绪标记找到实际内容容器；Fabric 可能把背景与弹层压平成兄弟节点。
 * @param nodes - 保留父子关系的可见节点。
 */
export function foregroundPanels(nodes: NativeNode[]): NativeNode[] {
  const markers = new Set(['drawer-menu-item-exit', 'card-rank-list', 'game-settings-close-button',
    'buy-in-title', 'renew-popup-close-button', 'public-leader-board-container', 'review-board-close-button',
    'review-board-description-text', 'in-game-chat-animated-view', 'buy-in-application-list',
    'player-profile-popup-close', 'report-field-input', 'accurate-bet-popup-container', 'raise-bet-popup',
    'in-game-audio-microphone-button', 'report-popup-title', 'BlockPlayerConfirmPopup:title', 'buy-in-review-close-button',
    'view-community-close-button', 'raise-blind-detail', 'auto-rebuy-popup', 'report-pair-play-close-button',
    'personal-leader-board-close-button', 'level-up-close-button', 'common-alert-message', 'in_game_report_message_component']);
  const panels: NativeNode[] = nodes.filter(node => node.res === 'base-review-board-container');
  for (const marker of nodes.filter(node => markers.has(node.res || ''))) {
    /**
     * 根据原生父子关系定位这个前景控件。
     * @param node - 当前检查的祖先节点。
     */
    const contains = (node: NativeNode): boolean => node === marker || Boolean(node.children?.some(contains));
    const panel = nodes.filter(node => node.bounds.width > 80 && node.bounds.height > 80
      // 半透明触摸背景和整个牌桌不能作为不透明面板。
      && node.bounds.width * node.bounds.height < 720 * 1280 * 0.95 && contains(node))
      .sort((first, second) => second.bounds.width * second.bounds.height - first.bounds.width * first.bounds.height)[0];
    if (panel && !panels.includes(panel)) panels.push(panel);
  }
  return panels;
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
    // 无障碍边界取整后，面板最外一像素仍可能露出背景；买入框实测漏出两个箭头像素。
    .reduce((parts, panel) => parts.flatMap(part => subtractPanel(part, {
      x: panel.bounds.x + 1, y: panel.bounds.y + 1,
      width: panel.bounds.width - 2, height: panel.bounds.height - 2,
    })), [mask]);
}
