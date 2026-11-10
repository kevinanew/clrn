/** 在浏览器中只读检查牌槽、图片资源与正面绘制状态。 */
/**
 * 汇总指定牌槽尚未就绪的原因；所有浏览器辅助函数随入口一起序列化。
 * @param selector - 当前动画实际展示牌面的容器选择器。
 * @returns 每个可见未就绪牌槽的诊断。
 */
export function cardSpriteReadinessState(selector: string): string[] {
  const checks = {
    /**
     * 判断牌槽是否与视口相交，保持边界等于零时的排除规则。
     * @param box - 牌槽矩形。
     * @returns 是否具有可见面积。
     */
    intersectsViewport(box: DOMRect): boolean {
      if (box.width === 0 || box.height === 0)
        return false;
      return !checks.outsideViewport(box);
    },
    /**
     * 检查牌槽在两个方向上是否完全位于视口之外。
     * @param box - 牌槽矩形。
     * @returns 是否完全越界。
     */
    outsideViewport(box: DOMRect): boolean {
      const horizontal = box.right <= 0 || box.left >= window.innerWidth;
      return horizontal || checks.outsideVertical(box);
    },
    /**
     * 检查竖直方向的交集。
     * @param box - 牌槽矩形。
     * @returns 是否完全越过上下边界。
     */
    outsideVertical(box: DOMRect): boolean { return box.bottom <= 0 || box.top >= window.innerHeight; },
    /**
     * 翻转前正面透明，仍以整个牌槽决定是否检查资源。
     * @param container - 当前精灵容器。
     * @returns 是否属于当前可见画面。
     */
    visibleSlot(container: HTMLElement): boolean {
      const card = container.closest<HTMLElement>(selector);
      if (!card?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        return false;
      return checks.intersectsViewport(card.getBoundingClientRect());
    },
    /**
     * 读取可选元素的样式，保持诊断中的缺失标记。
     * @param node - 可选页面元素。
     * @param property - 要读取的样式属性。
     * @param missing - 元素未挂载时的标记。
     * @returns 样式或缺失标记。
     */
    styleValue(node: Element | null, property: 'transform' | 'display' | 'opacity', missing: string): string {
      return node ? getComputedStyle(node)[property] : missing;
    },
    /**
     * 确认正面层已完全显示；没有翻牌组件时视为普通正面。
     * @param flip - 翻牌组件。
     * @param opacity - 正面层透明度。
     * @returns 正面层是否朝向观众。
     */
    faceShown(flip: Element | null, opacity: number | null): boolean {
      if (!flip)
        return true;
      return opacity !== null && opacity > 0.99;
    },
    /**
     * 排除零宽及近乎侧立的翻转阶段。
     * @param container - 精灵容器。
     * @param box - 当前绘制矩形。
     * @returns 正面是否有足够的绘制宽度。
     */
    faceWidth(container: HTMLElement, box: DOMRect): boolean {
      return container.offsetWidth > 0 && box.width >= container.offsetWidth * 0.5;
    },
    /**
     * 确认图片已取得有效资源。
     * @param image - 实际图集图片。
     * @returns 资源是否下载完成。
     */
    imageReady(image: HTMLImageElement | null): boolean { return Boolean(image?.complete && image.naturalWidth > 0); },
    /**
     * 检查已提交的牌面布局。
     * @param box - 精灵容器矩形。
     * @returns 宽高是否均大于零。
     */
    hasArea(box: DOMRect): boolean { return box.width > 0 && box.height > 0; },
    /**
     * 确认裁切层两个方向的缩放都已完成。
     * @param transform - 裁切层实际变换。
     * @returns 是否具有有效缩放。
     */
    transformReady(transform: DOMMatrixReadOnly | null): boolean {
      if (!transform)
        return false;
      return Math.abs(transform.m11) > 0.001 && Math.abs(transform.m22) > 0.001;
    },
    /**
     * 检查后备图退场与精灵透明度，保留短路检查顺序。
     * @param fallback - 后备图。
     * @param content - 精灵内容。
     * @returns 是否已显示精灵而非文字回退。
     */
    contentReady(fallback: HTMLElement | null, content: HTMLElement | null): boolean {
      if (!checks.fallbackHidden(fallback))
        return false;
      return Boolean(content && Number(getComputedStyle(content).opacity) > 0.99);
    },
    /**
     * 后备图必须真实挂载且已经隐藏。
     * @param fallback - 后备图。
     * @returns 是否已隐藏。
     */
    fallbackHidden(fallback: HTMLElement | null): boolean {
      return Boolean(fallback && getComputedStyle(fallback).display === 'none');
    },
    /**
     * 读取实际裁切变换，none 保持空状态。
     * @param value - CSS 变换。
     * @returns 实际矩阵或空值。
     */
    clipperMatrix(value: string): DOMMatrixReadOnly | null {
      return value === 'none' ? null : new DOMMatrixReadOnly(value);
    },
    /**
     * 图片与容器必须同时具有有效尺寸。
     * @param image - 图片资源。
     * @param box - 容器边界。
     * @returns 是否资源就绪。
     */
    resourceHasArea(image: HTMLImageElement | null, box: DOMRect): boolean {
      return checks.imageReady(image) && checks.hasArea(box);
    },
    /**
     * 隐藏正面只检查资源；露出的正面还必须完成裁切和显示提交。
     * @param frontFacing - 正面是否朝向观众。
     * @param transform - 裁切变换。
     * @param fallback - 后备图。
     * @param content - 精灵内容。
     * @returns 正面显示是否就绪。
     */
    presentationReady(frontFacing: boolean, transform: DOMMatrixReadOnly | null, fallback: HTMLElement | null, content: HTMLElement | null): boolean {
      if (!frontFacing)
        return true;
      return checks.transformReady(transform) && checks.contentReady(fallback, content);
    },
    /**
     * 检查一个可见牌槽，保留全部原始诊断字段。
     * @param container - 精灵容器。
     * @param index - 牌槽序号。
     * @returns 当前牌槽的未就绪诊断。
     */
    checkContainer(container: HTMLElement, index: number): string[] {
      const details = {
        /** 结合当前快照判断正面和资源，避免重复读取布局。 */
        checkPresentation(): string[] {
          const box = container.getBoundingClientRect();
          const facing = frontVisible && checks.faceShown(flip, faceOpacity);
          const frontFacing = facing && checks.faceWidth(container, box);
          return details.readinessResult(box, frontFacing);
        },
        /**
         * 完整就绪时返回空诊断。
         * @param box - 当前容器边界。
         * @param frontFacing - 正面朝向观众的状态。
         * @returns 当前槽的诊断。
         */
        readinessResult(box: DOMRect, frontFacing: boolean): string[] {
          const resourceReady = checks.resourceHasArea(image, box);
          if (resourceReady && checks.presentationReady(frontFacing, transform, fallback, content))
            return [];
          return [details.diagnostic(box, frontFacing)];
        },
        /**
         * 保留图片加载与原始宽度的缺失值显示。
         * @returns 图片资源诊断。
         */
        imageDiagnostic(): string {
          return `图片加载=${image?.complete ?? '缺失'}；` + details.imageWidthDiagnostic();
        },
        /** 读取图片原宽，缺失时保持原始标记。 */
        imageWidthDiagnostic(): string { return `图片原宽=${image?.naturalWidth ?? '缺失'}；`; },
        /**
         * 组合翻牌组件的状态与正面透明度。
         * @returns 翻牌状态诊断。
         */
        faceDiagnostic(): string {
          const side = details.flipSide();
          return `牌面 ${index} 图集未就绪：翻牌侧=${side}；` + `正面层透明度=${faceOpacity ?? '无'}；`;
        },
        /** 读取翻牌侧标记，缺失时保持原诊断。 */
        flipSide(): string { return flip?.getAttribute('data-side') ?? '无'; },
        /**
         * 组装原始错误文本，保留资源、布局与正面绘制证据。
         * @param box - 当前容器边界。
         * @param frontFacing - 是否朝向观众。
         * @returns 未就绪原因。
         */
        diagnostic(box: DOMRect, frontFacing: boolean): string {
          return details.faceDiagnostic() + `正面可见=${frontVisible}；正面朝向观众=${frontFacing}；回退显示=${checks.styleValue(fallback, 'display', '缺失')}；`
            + `内容透明度=${checks.styleValue(content, 'opacity', '缺失')}；裁切变换=${clipperTransform}；`
            + details.imageDiagnostic() + `牌面宽高=${box.width}×${box.height}；牌面原宽=${container.offsetWidth}`;
        }
      };
      if (!checks.visibleSlot(container))
        return [];
      const fallback = container.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]');
      const content = container.querySelector<HTMLElement>('[data-testid="sprite-image-content"]');
      const clipper = container.querySelector<HTMLElement>('[data-testid="sprite-image-clipper"]');
      const image = container.querySelector<HTMLImageElement>('[data-testid="sprite-image-view"] img');
      const clipperTransform = checks.styleValue(clipper, 'transform', 'none');
      const transform = checks.clipperMatrix(clipperTransform);
      const frontVisible = container.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const flip = container.closest<HTMLElement>('[data-testid="card-flip"]');
      const faceSide = container.closest<HTMLElement>('[data-testid="card-flip-side-b"]');
      const faceOpacity = faceSide ? Number(getComputedStyle(faceSide).opacity) : null;
      return details.checkPresentation();
    }
  };
  const containers = document.querySelectorAll<HTMLElement>(`${selector} [data-testid="sprite-image-container"]`);
  if (containers.length === 0)
    return ['目标牌面图集尚未挂载'];
  return Array.from(containers).flatMap(checks.checkContainer);
}
/**
 * 解码已取得资源的图片并向诊断器报告成功或失败；异常继续传播。
 * @param selector - 当前动画展示牌面的容器选择器。
 */
export async function decodeCardSpriteImages(selector: string): Promise<void> {
  const decoding = {
    /**
     * 只解码已下载且具有有效尺寸的图片。
     * @param image - 图集图片。
     * @returns 是否已下载。
     */
    downloaded(image: HTMLImageElement): boolean { return image.complete && image.naturalWidth > 0; },
    /**
     * 有诊断采集器时报告实际解码结果。
     * @param image - 图集图片。
     * @param outcome - 解码结果。
     * @param source - 解码时使用的资源。
     */
    async notifyDecoded(image: HTMLImageElement, outcome: string, source: string): Promise<void> {
      await state.__clrnCardSpriteDecoded?.(image, outcome, source);
    },
    /**
     * 解码单张图片，先记录拒绝再传播原异常。
     * @param image - 图集图片。
     */
    async decode(image: HTMLImageElement): Promise<void> {
      const source = image.currentSrc || image.src;
      try {
        await image.decode();
      }
      catch (error) {
        await decoding.notifyDecoded(image, 'rejected', source);
        throw error;
      }
      await decoding.notifyDecoded(image, 'fulfilled', source);
    }
  };
  const images = document.querySelectorAll<HTMLImageElement>(`${selector} [data-testid="sprite-image-view"] img`);
  const state = window as typeof window & {
    __clrnCardSpriteDecoded?: (image: HTMLImageElement, outcome: string, source: string) => Promise<void>;
  };
  await Promise.all(Array.from(images).filter(decoding.downloaded).map(decoding.decode));
}
