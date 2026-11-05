// 稳定截图中的易变内容，并在保存大厅截图前检查扑克牌图标没有被容器裁切。
import type { Locator, Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';

/**
 * 暂停并隐藏视频，避免播放帧不定
 * @param page - 执行操作的 Playwright 页面。
 */
export async function stabilizeVideos(page: Page): Promise<void> {
  await page.evaluate(/** 停止背景图动画并暂停隐藏视频，消除动态背景截图差异。 */ async () => {
    document.querySelectorAll('[data-testid="video-background-image"]').forEach(/** 清除背景图片的动画和变换，固定背景位置。
 * @param el - 当前匹配的页面元素。 */ (el) => {
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
        /** 为当前视频等待加载并执行固定播放状态的操作。
 * @param video - 当前操作使用的 video。 */ (video) =>
          new Promise<void>(/** 在视频就绪、失败或等待到期时完成稳定化并解除等待。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => {
            /** 暂停页面视频并固定播放位置，消除动态帧造成的截图变化。 */
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

/**
 * backdrop-filter 在 Docker Chromium 下渲染有随机噪点，直接关掉
 * @param page - 执行操作的 Playwright 页面。
 */
export async function stabilizeBackdropFilter(page: Page): Promise<void> {
  await page.evaluate(/** 遍历页面中使用背景滤镜的节点，固定其渲染样式。 */ () => {
    document.querySelectorAll('*').forEach(/** 对当前带背景滤镜的节点应用确定性样式，消除合成差异。
 * @param el - 当前匹配的页面元素。 */ (el) => {
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
    /** 在页面中读取`new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); })`，供测试判断当前界面状态。 */ () =>
      new Promise<void>(/** 等待两个浏览器动画帧，使样式修改完成布局提交。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => {
        requestAnimationFrame(/** 推进渲染帧等待，在浏览器完成本帧布局后继续。 */ () => requestAnimationFrame(/** 推进渲染帧等待，在浏览器完成本帧布局后继续。 */ () => resolve()));
      }),
  );
}

/**
 * 私人房快捷入口按 375 设计稿缩放后，文字容器会落在小数 CSS 像素上
 * （desktop 实测 x=.46875、y=.140625）。Skia 对小数坐标的中文抗锯齿偶尔会有
 * 1 级灰度舍入差，导致同一容器内十几个像素漂移。把容器左上角平移到最近的整数
 * 像素，保留文字与布局，只消除栅格化的非确定性。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function alignPersonalHouseTitlesToDevicePixels(page: Page): Promise<void> {
  await page.evaluate(/** 将私人房入口标题的布局偏移对齐到整数像素。 */ () => {
    document
      .querySelectorAll(
        '[data-testid="personal-house-create-title-container"], ' +
          '[data-testid="personal-house-join-title-container"]',
      )
      .forEach(/** 根据当前标题位置计算像素校正量并设置平移。
 * @param el - 当前匹配的页面元素。 */ (el) => {
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
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 */
export async function applyContentStabilizers(page: Page, scenario: VisualScenario): Promise<void> {
  if (scenario.fixedTexts.length === 0 && scenario.hideSelectors.length === 0) {
    return;
  }

  await page.evaluate(
    /** 安装文本和隐藏元素稳定化逻辑，并在 DOM 更新后重新应用。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({
      fixedTexts,
      hideSelectors,
    }: {
      fixedTexts: Array<{ selector: string; text: string }>;
      hideSelectors: string[];
    }) => {
      /** 写入场景固定文案并隐藏动态元素，在 DOM 更新后重新应用。 */
      const apply = () => {
        fixedTexts.forEach(/** 为当前固定文案规则查找全部目标节点并更新显示内容。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ selector, text }) => {
          document.querySelectorAll(selector).forEach(/** 根据节点类型写入输入框值或文本内容，保留相同内容不重复更新。
 * @param el - 当前匹配的页面元素。 */ (el) => {
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

        hideSelectors.forEach(/** 遍历当前隐藏规则匹配的全部节点。
 * @param selector - 当前操作使用的 selector。 */ (selector) => {
          document.querySelectorAll(selector).forEach(/** 为目标元素设置最高优先级隐藏样式，避免动态内容进入截图。
 * @param el - 当前匹配的页面元素。 */ (el) => {
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

/**
 * 等待当前画面的图片并拒绝缺失的同源构建资源，避免截图接受缺图页面。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function ensureLocalImagesLoaded(page: Page): Promise<void> {
  await page.evaluate(/** 等待当前画面中的实际图片完成加载与必要重试，排除保留的隐藏页面。 */ async () => {
    /**
     * 不检查保留在页面结构中、但当前画面不可见的其他界面图片。
     * 可见牌面的图集在加载期间透明，仍须等待其实际图片。
     * @param img - 待判断是否出现在当前画面的图片。
     */
    const isVisibleImage = (img: HTMLImageElement) => {
      const subject = img.dataset.testid === 'sprite-image-view'
        ? img.closest('[data-testid="card-flip"]') || img.closest('[data-testid="sprite-image-container"]') || img : img;
      if (!subject.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const rect = subject.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < window.innerWidth && rect.top < window.innerHeight;
    };
    /** 页面切换期间图片节点可能被替换，每次只读取当前文档中的可见节点。 */
    const currentImages = () => Array.from(document.images).filter(isVisibleImage);
    /**
     * 等待图片请求结束，之后仍以实际解码尺寸决定是否通过。
     * @param img - 待检查的页面图片。
     */
    const waitForImage = (img: HTMLImageElement) => new Promise<void>(/** 临时监听图片加载和失败事件，结束或超时后移除监听器。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => {
      let timeout = 0;
      /** 保留应用原有的加载回调，结束等待后移除临时监听。 */
      const finish = () => {
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        window.clearTimeout(timeout);
        resolve();
      };
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
      timeout = window.setTimeout(finish, 10000);
    });
    const initialImages = currentImages();
    await Promise.all(initialImages.filter(/** 仅保留满足以下条件的条目：`!img.complete`。
 * @param img - 当前操作使用的 img。 */ (img) => !img.complete).map(waitForImage));
    await Promise.all(currentImages()
      .filter(/** 仅保留满足以下条件的条目：`!initialImages.includes(img) && !img.complete`。
 * @param img - 当前操作使用的 img。 */ (img) => !initialImages.includes(img) && !img.complete)
      .map(waitForImage));

    // `img.complete` 在加载失败时同样为 true。远端头像允许失败，但同源构建
    // 资源必须有真实尺寸，否则中止场景，禁止污染快照。
    /**
     * 判断同源构建图片是否仍无可解码的尺寸。
     * @param img - 待检查的页面图片。
     */
    const isFailedLocalImage = (img: HTMLImageElement) => {
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
    };
    // 本地代理偶尔会在并发取图时关闭连接。只对失败的同源图片重新请求一次；
    // 如果文件缺失或内容无法解码，第二次仍会在下面报错。
    await Promise.all(currentImages().filter(isFailedLocalImage).map(/** 对失败的本地图片添加一次性重试参数并等待重载完成。
 * @param img - 当前操作使用的 img。 */ async (img) => {
      const url = new URL(img.src, window.location.href);
      if (url.searchParams.has('__clrn_retry')) return;
      url.searchParams.set('__clrn_retry', '1');
      const loaded = waitForImage(img);
      img.src = url.href;
      await loaded;
    }));
    const failedLocalImages = currentImages().filter(isFailedLocalImage);
    if (failedLocalImages.length > 0) {
      const failedSources = failedLocalImages
        .slice(0, 5)
        .map(/** 将当前条目映射为`new URL(img.src, window.location.href).pathname`。
 * @param img - 当前操作使用的 img。 */ (img) => new URL(img.src, window.location.href).pathname);
      throw new Error(`本地图片加载失败: ${failedSources.join(', ')}`);
    }
  });
}

/**
 * 锁定页面宽度，同时保留俱乐部、钱包分页轨道和精灵图内部画布的固有尺寸。
 *
 * SpriteImage 通过在完整图集上平移来显示指定牌面；覆盖 sprite-image-view 的宽度会
 * 让平移坐标与画布尺寸失配，牌面因此被裁切或出现在错误位置。
 * @param page - 执行操作的 Playwright 页面。
 * @param width - 预期的页面宽度，单位为像素。
 */
export async function lockPageWidth(page: Page, width: number): Promise<void> {
  await page.evaluate(/** 限制页面与可裁切节点宽度，避免水平溢出改变截图尺寸。
 * @param viewportWidth - 当前操作使用的 viewportWidth。 */ (viewportWidth: number) => {
    /**
     * 固定元素宽度及最大宽度，防止内容溢出改变截图视口。
     * @param el - 需要固定宽度的 DOM 元素。
     */
    const lock = (el: HTMLElement) => {
      el.style.setProperty('overflow-x', 'hidden', 'important');
      el.style.setProperty('max-width', `${viewportWidth}px`, 'important');
      el.style.setProperty('width', `${viewportWidth}px`, 'important');
    };
    lock(document.documentElement);
    lock(document.body);
    document.querySelectorAll('*').forEach(/** 固定普通溢出节点宽度，保留俱乐部和钱包双页轨道的原始布局。
 * @param el - 当前匹配的页面元素。 */ (el) => {
      // 俱乐部通过平移双页轨道显示当前页。轨道宽度必须保留为两页之和，
      // 否则第二页会被新增的 overflow 裁掉；页面视口及应用自身容器负责裁切。
      if (el.closest('[data-testid="club-tab-screen"]')) {
        return;
      }
      // 钱包也使用双页轨道；保留列表及其祖先的原始宽度，避免切换钻石时整页被裁空。
      const coinTransactionList = '[data-testid="coin-transaction-record-view"]';
      if (el.closest(coinTransactionList) || el.querySelector(coinTransactionList)) {
        return;
      }
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

/**
 * 检查两种游戏图标的完整高度，拒绝把被限宽逻辑裁掉顶部的画面保存为基准。
 * @param page - 已完成页面准备的大厅页面。
 */
export async function assertMatchingArtworkVisible(page: Page): Promise<void> {
  await page.getByTestId('matching-title-switch-button').evaluateAll(
    /**
     * 核对图标与滚动列表内部祖先的真实边界；列表本身允许正常滚动。
     * @param elements - 德州扑克和拼三张的图标元素。
     */
    (elements) => {
      if (elements.length !== 2) throw new Error('大厅应包含两种游戏的扑克牌图标');
      for (const [index, element] of elements.entries()) {
        const artwork = element.getBoundingClientRect();
        if (artwork.height <= 0) throw new Error('大厅扑克牌图标没有可见高度');
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent.dataset.testid === 'hall-content-list') break;
          const bounds = parent.getBoundingClientRect();
          if (getComputedStyle(parent).overflowY !== 'visible'
            && (artwork.top < bounds.top - 0.5 || artwork.bottom > bounds.bottom + 0.5)) {
            throw new Error(`大厅第 ${index + 1} 个扑克牌图标被祖先容器裁切`);
          }
        }
      }
    },
  );
}

/**
 * 就绪标记是长列表容器且顶部已经可见时，保留导航栏及当前滚动位置。
 * @param ready - 当前可见页面的就绪标记。
 */
export async function scrollVisualReadyElementIntoView(ready: Locator): Promise<void> {
  const visibleLongContainer = await ready.evaluate(/** 判断就绪元素是否高于视口且顶部已可见，避免不必要的滚动。
 * @param element - 当前匹配的页面元素。 */ (element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.height > window.innerHeight && bounds.top >= 0 && bounds.top < window.innerHeight;
  });
  if (!visibleLongContainer) await ready.scrollIntoViewIfNeeded();
}
