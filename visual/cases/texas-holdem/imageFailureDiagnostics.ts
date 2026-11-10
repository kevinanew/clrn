import { type Page, type TestInfo } from '@playwright/test';
import { diagnosticText } from '../../../e2e/helpers/diagnostic-privacy';
import { cardSpriteResource } from '../../animations/cardSpritePrivacy';

/** 失败后只读保存图片解码与布局状态，不推进时钟、不重试断言。
 * @param page - 原始失败页面。
 * @param info - 本轮报告。
 * @param label - 当前场景标识。 */
export async function saveImageFailureDiagnostics(page: Page, info: TestInfo, label: string): Promise<void> {
  if (!['signed_in_texas_game', 'signed_in_zhajinhua_game'].includes(label)) return;
  try {
    const images = await page.evaluate(/** 限量读取图片，不收集页面正文、用户标识或认证缓存。 */ () =>
      Array.from(document.querySelectorAll('img, [style*="background-image"], [data-testid="sprite-image-container"], [data-testid="player_victory_container"] *'))
        .filter(/** 保留有几何尺寸的图片，包括透明但尚未显示的图集。
         * @param node - 图片或图集节点。 */ node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }).slice(0, 300).map(/** 仅输出几何、解码和样式字段；资源在宿主持久化前转换为指纹。
         * @param node - 当前图片节点。
         * @param index - 本次快照中的匿名序号。 */ (node, index) => {
          const style = getComputedStyle(node);
          const image = node instanceof HTMLImageElement ? node : null;
          const decoded = image ? { resource: image.currentSrc || image.src, complete: image.complete,
            width: image.naturalWidth, height: image.naturalHeight }
            : { resource: style.backgroundImage, complete: null, width: null, height: null };
          return { index, kind: image ? 'image' : 'background-or-sprite',
            ...decoded, box: node.getBoundingClientRect().toJSON(),
            opacity: style.opacity, transform: style.transform, backgroundSize: style.backgroundSize,
            backgroundPosition: style.backgroundPosition, objectFit: style.objectFit,
            victory: Boolean(node.closest('[data-testid="player_victory_container"]')),
            animations: node.getAnimations().map(/** 只读动画相位，不暂停或推进。
             * @param animation - 节点已有的动画。 */ animation => ({
              currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
              playState: animation.playState,
            })) };
        }));
    const safe = images.map(/** 资源仅保留匿名指纹，禁止保存地址和查询参数。
     * @param entry - 浏览器只读快照。 */ entry => ({ ...entry, resource: cardSpriteResource(entry.resource) }));
    await info.attach('image-failure-layout', {
      body: JSON.stringify({ images: safe, limitation: '失败后只读快照；解码成功不等于布局或应用加载回调完成。' }),
      contentType: 'application/json',
    });
  } catch { /* 诊断失败不得覆盖原始异常或改变结果。 */ }
}

/** 保存失败诊断并脱敏原始异常，保留各场景的截图超时设置。
 * @param page - 原始失败页面。
 * @param info - 本轮报告。
 * @param label - 当前场景标识。
 * @param diagnostics - 连接诊断收集器。
 * @param error - 原始异常。
 * @param timeout - 可选截图超时。 */
export async function saveScenarioFailure(page: Page, info: TestInfo, label: string,
  diagnostics: { save(error?: unknown): Promise<void> }, error: unknown, timeout?: number): Promise<void> {
  await saveImageFailureDiagnostics(page, info, label);
  await diagnostics.save(error).catch(/** 诊断保存失败时保留原始异常。
   * @param failure - 诊断保存错误。 */ failure => console.log(`诊断保存失败：${diagnosticText(failure)}`));
  await page.screenshot({ path: info.outputPath('failure.png'), timeout }).catch(/** 截图失败时保留原始异常。 */ () => undefined);
  if (error instanceof Error) { error.message = diagnosticText(error.message); error.stack = diagnosticText(error.stack); }
}
