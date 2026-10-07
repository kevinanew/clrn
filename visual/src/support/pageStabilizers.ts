import type { Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';

/** 暂停并隐藏视频，避免播放帧不定 */
export async function stabilizeVideos(page: Page): Promise<void> {
  await page.evaluate(async () => {
    document.querySelectorAll('[data-testid="video-background-image"]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.animation = 'none';
      htmlEl.style.transform = 'none';
    });

    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) {
      return;
    }

    await Promise.all(
      videos.map(
        (video) =>
          new Promise<void>((resolve) => {
            const stabilize = () => {
              video.pause();
              video.autoplay = false;
              video.loop = false;
              try {
                video.currentTime = 0;
              } catch {
                // ignore
              }
              video.style.opacity = '0';
              resolve();
            };

            if (video.readyState >= 1) {
              stabilize();
              return;
            }

            video.addEventListener('loadeddata', stabilize, { once: true });
            setTimeout(stabilize, 2000);
          }),
      ),
    );
  });
}

/** backdrop-filter 在 Docker Chromium 下渲染有随机噪点，直接关掉 */
export async function stabilizeBackdropFilter(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const backdrop =
        style.backdropFilter ||
        (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if (!backdrop || backdrop === 'none') {
        return;
      }
      const htmlEl = el as HTMLElement;
      htmlEl.style.setProperty('backdrop-filter', 'none', 'important');
      htmlEl.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    });
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * 私人房快捷入口按 375 设计稿缩放后，文字容器会落在小数 CSS 像素上
 * （desktop 实测 x=.46875、y=.140625）。Skia 对小数坐标的中文抗锯齿偶尔会有
 * 1 级灰度舍入差，导致同一容器内十几个像素漂移。把容器左上角平移到最近的整数
 * 像素，保留文字与布局，只消除栅格化的非确定性。
 */
export async function alignPersonalHouseTitlesToDevicePixels(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[data-testid="personal-house-create-title-container"], ' +
          '[data-testid="personal-house-join-title-container"]',
      )
      .forEach((el) => {
        const node = el as HTMLElement;
        const rect = node.getBoundingClientRect();
        const offsetX = Math.round(rect.x) - rect.x;
        const offsetY = Math.round(rect.y) - rect.y;
        node.style.setProperty('transform', `translate(${offsetX}px, ${offsetY}px)`, 'important');
      });
  });
}

/**
 * 易变文本替换为固定值（内容仍可读）；hideSelectors 仅用于出现与否不定的元素。
 *
 * 不能只改一次 DOM：测速、版本检查等异步 MobX 更新可能在页面就绪后触发 React
 * 重渲染，把固定值覆盖回真实值。MutationObserver 会在这些 DOM 变化进入下一帧绘制前
 * 重新应用规则，确保 toHaveScreenshot 的两次稳定截图看到相同内容。
 */
export async function applyContentStabilizers(page: Page, scenario: VisualScenario): Promise<void> {
  if (scenario.fixedTexts.length === 0 && scenario.hideSelectors.length === 0) {
    return;
  }

  await page.evaluate(
    ({
      fixedTexts,
      hideSelectors,
    }: {
      fixedTexts: Array<{ selector: string; text: string }>;
      hideSelectors: string[];
    }) => {
      const apply = () => {
        fixedTexts.forEach(({ selector, text }) => {
          document.querySelectorAll(selector).forEach((el) => {
            // RN Web 单行 TextInput 渲染成 <input>，textContent 对其无视觉效果，必须改设 value
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              if (el.value !== text) {
                el.value = text;
              }
            } else if (el.textContent !== text) {
              el.textContent = text;
            }
          });
        });

        hideSelectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((el) => {
            const node = el as HTMLElement;
            if (
              node.style.display !== 'none' ||
              node.style.getPropertyPriority('display') !== 'important'
            ) {
              node.style.setProperty('display', 'none', 'important');
            }
          });
        });
      };

      apply();
      const visualWindow = window as typeof window & {
        __visualContentStabilizerObserver?: MutationObserver;
      };
      visualWindow.__visualContentStabilizerObserver?.disconnect();
      const observer = new MutationObserver(apply);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: hideSelectors.length > 0,
        attributeFilter: hideSelectors.length > 0 ? ['style'] : undefined,
      });
      visualWindow.__visualContentStabilizerObserver = observer;
    },
    {
      fixedTexts: scenario.fixedTexts,
      hideSelectors: scenario.hideSelectors,
    },
  );
}

/** 等待页面图片并拒绝缺失的同源构建资源，避免 reference 接受缺图页面。 */
export async function ensureLocalImagesLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(resolve, 10000);
            }),
        ),
    );

    // `img.complete` 在加载失败时同样为 true。远端头像允许失败，但同源构建
    // 资源必须有真实尺寸，否则中止场景，禁止污染快照。
    const failedLocalImages = images.filter((img) => {
      if (!img.src) {
        return false;
      }
      try {
        const url = new URL(img.src, window.location.href);
        return (
          url.origin === window.location.origin &&
          (img.naturalWidth === 0 || img.naturalHeight === 0)
        );
      } catch {
        return false;
      }
    });
    if (failedLocalImages.length > 0) {
      const failedSources = failedLocalImages
        .slice(0, 5)
        .map((img) => new URL(img.src, window.location.href).pathname);
      throw new Error(`本地图片加载失败: ${failedSources.join(', ')}`);
    }
  });
}

/**
 * 锁定页面宽度，同时保留精灵图内部画布的固有尺寸。
 *
 * SpriteImage 通过在完整图集上平移来显示指定牌面；覆盖 sprite-image-view 的宽度会
 * 让平移坐标与画布尺寸失配，牌面因此被裁切或出现在错误位置。
 */
export async function lockPageWidth(page: Page, width: number): Promise<void> {
  await page.evaluate((viewportWidth: number) => {
    const lock = (el: HTMLElement) => {
      el.style.setProperty('overflow-x', 'hidden', 'important');
      el.style.setProperty('max-width', `${viewportWidth}px`, 'important');
      el.style.setProperty('width', `${viewportWidth}px`, 'important');
    };
    lock(document.documentElement);
    lock(document.body);
    document.querySelectorAll('*').forEach((el) => {
      // 扑克牌精灵图的内部画布天然宽于视口，不能改变画布或其裁切容器的尺寸；
      // 否则移动端会按被截断的图集重新计算偏移，正面牌会移出卡槽。
      if (
        (el as HTMLElement).dataset.testid === 'sprite-image-view' ||
        el.closest('[data-testid="sprite-image-view"]') ||
        el.querySelector('[data-testid="sprite-image-view"]')
      ) {
        return;
      }
      if ((el as HTMLElement).scrollWidth > viewportWidth) {
        const htmlEl = el as HTMLElement;
        htmlEl.style.setProperty('max-width', `${viewportWidth}px`, 'important');
        htmlEl.style.setProperty('overflow-x', 'hidden', 'important');
      }
    });
  }, width);
}
