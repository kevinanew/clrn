/**
 * 截图前的页面准备：
 * 过 staging 弹窗、登录态确认、tab/子页导航、就绪等待、渲染稳定化、
 * 易变文本固定填充。
 */
import type { Locator, Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarios';
import {
  dismissSignedInPopups,
  dumpPageState,
  ensureAppReadyPastStaging,
  waitForSignInState,
} from './authFlow';

/**
 * 等待选择器不可见；若弹层因导航打断 dismiss 而卡住，
 * 先点 backdrop / Escape，仍不行则强制 display:none（仅截图稳定化）。
 *
 * 注意：整个 App 挂载在单一的 body 子节点 `#root` 下，且 BottomSheetModal 未走独立
 * 的顶层 portal——sheet 面板与 backdrop 在 DOM 里是两棵不相交的子树，二者最近公共
 * 祖先几乎顶到 `#root` 本身（含整个 App）。不能用「摘除公共祖先」兜底，那会连
 * `#root` 一起摘掉，截图变全白。兜底策略：
 * 1. 直接隐藏匹配节点（覆盖非 BottomSheet 弹层，如 club-more-popup / RN Modal）
 * 2. 若在 BottomSheet 内：再隐藏 `aria-label="Bottom Sheet"` 面板与 backdrop button
 * 3. 若在 PopUp/Modal 内：再隐藏祖先 `popup-backdrop`（透明全屏层，否则仍可能叠在截图上）
 */
export async function ensureSelectorGone(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  try {
    await target.waitFor({ state: 'hidden', timeout: 5000 });
    return;
  } catch {
    // continue
  }

  const backdrop = page.getByRole('button', { name: /Bottom sheet backdrop/i }).first();
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ force: true }).catch(() => undefined);
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
  }

  try {
    await target.waitFor({ state: 'hidden', timeout: 5000 });
    return;
  } catch {
    // continue
  }

  await page.evaluate((goneSelector: string) => {
    document.querySelectorAll(goneSelector).forEach((el) => {
      const node = el as HTMLElement;
      node.style.setProperty('display', 'none', 'important');

      let sheet: HTMLElement | null = node;
      while (sheet && sheet.getAttribute('aria-label') !== 'Bottom Sheet') {
        sheet = sheet.parentElement;
      }
      sheet?.style.setProperty('display', 'none', 'important');

      let popupBackdrop: HTMLElement | null = node.parentElement;
      while (popupBackdrop && popupBackdrop.getAttribute('data-testid') !== 'popup-backdrop') {
        popupBackdrop = popupBackdrop.parentElement;
      }
      popupBackdrop?.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('[role="button"][aria-label*="backdrop" i]').forEach((el) => {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
    });
  }, selector);

  await target.waitFor({ state: 'hidden', timeout: 5000 });
}

/**
 * SectionList 在 RN Web 上会虚拟化列表项；「我的」页的商城等项目在首屏外时，
 * 对尚未挂载的 testID 调用 scrollIntoViewIfNeeded 无效。主动滚动 settings-list，
 * 让目标 cell 进入 DOM 后再点击。
 */
export async function revealVirtualizedSettingsItem(page: Page, target: Locator): Promise<void> {
  // React Navigation 会保留非活动 tab 的 DOM；必须滚动当前可见列表，否则可能一直
  // 操作隐藏的旧 settings-list，目标 cell 永远不会进入 DOM。
  const settingsList = page.locator('[data-testid="settings-list"]:visible').last();
  if (!(await settingsList.count())) {
    return;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await target.count()) {
      return;
    }
    await settingsList
      .evaluate((el) => {
        const node = el as HTMLElement;
        node.scrollTop += Math.max(node.clientHeight * 0.75, 240);
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      })
      .catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

/**
 * 恢复指定可见滚动容器的首屏位置。
 *
 * RN Web 的异步图片/列表布局可能让 scrollIntoViewIfNeeded 先按临时高度滚动，
 * 随后内容收缩却保留 scrollTop，最终把页面顶部内容裁出截图。复位后派发 scroll，
 * 让 FlatList 同步虚拟化窗口，再等两帧完成布局。
 */
export async function resetScrollToStart(page: Page, selector: string): Promise<void> {
  const scrollContainer = page.locator(`${selector}:visible`).last();
  if (!(await scrollContainer.count())) {
    return;
  }

  await scrollContainer.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** 点击 data-testid 元素并等待页面稳定（loading 消失）；被遮罩拦截时降级为 JS click */
async function clickByTestId(page: Page, testId: string): Promise<void> {
  // 嵌套导航会留下同 testID 的隐藏节点；点击当前可见节点可避免无意义的超时与 JS 降级。
  const target = page.locator(`[data-testid="${testId}"]:visible`).last();
  // 常规节点会立即挂载；超过短暂初始化期仍不存在时，尝试唤醒「我的」页的虚拟列表项。
  await target.waitFor({ state: 'attached', timeout: 3000 }).catch(async () => {
    await revealVirtualizedSettingsItem(page, target);
  });
  await target.waitFor({ state: 'attached', timeout: 60000 });
  // 必须显式限时：对 Playwright 误判不可见的元素该调用会无限等待
  await target.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  try {
    // 短超时即可：可点击的元素通常瞬间完成；超时基本都是误判不可见，
    // 长等无意义（之前 15s 白等），直接降级 JS click（已验证可靠）
    // RN Web 导航会让 Playwright 误等一个不会结束的 scheduled navigation；
    // 页面是否到达由后续 visualReadySelector 明确判断，这里只负责派发点击。
    await target.click({ timeout: 3000, noWaitAfter: true });
  } catch {
    console.log(`DEBUG > click "${testId}" 降级为 JS click`);
    // Playwright click 可能已经派发点击并触发导航，只是在等待过程中原节点被卸载。
    // 不能再对同一个 Locator evaluate（它会等待已消失的节点直到 actionTimeout）。
    const clicked = await page
      .evaluate((id: string) => {
        const candidates = Array.from(
          document.querySelectorAll(`[data-testid="${CSS.escape(id)}"]`),
        ) as HTMLElement[];
        const visible = candidates.filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        });
        const current = visible.at(-1);
        current?.click();
        return Boolean(current);
      }, testId)
      .catch(() => false);
    if (!clicked) {
      console.log(`DEBUG > click "${testId}" 后节点已卸载，按已触发导航继续`);
    }
  }
  await page.waitForTimeout(250);
  await page
    .waitForFunction(() => !document.querySelector('[role="progressbar"]'), undefined, {
      timeout: 60000,
    })
    .catch(() => undefined);
}

/**
 * 选玩法弹层的 onPress 偶尔会完成 dismiss 却丢失 navigate，页面回到私人房详情。
 * 仅对建房表单场景重开弹层并重选一次；其它页面仍直接暴露真实导航失败。
 */
async function retryCreateRoomNavigation(page: Page, scenario: VisualScenario): Promise<boolean> {
  if (!scenario.pageLabel.startsWith('signed_in_create_room_form')) {
    return false;
  }

  const gameTypeTestId = scenario.navClickTestIds.find((testId) =>
    testId.startsWith('game-type-button-'),
  );
  if (!gameTypeTestId) {
    return false;
  }

  const createGameVisible = await page
    .locator('[data-testid="create-game-button"]:visible')
    .last()
    .isVisible()
    .catch(() => false);
  if (!createGameVisible) {
    const personalHouseCreateVisible = await page
      .locator('[data-testid="personal-house-create"]:visible')
      .last()
      .isVisible()
      .catch(() => false);
    if (!personalHouseCreateVisible) {
      return false;
    }
    await clickByTestId(page, 'personal-house-create');
  }

  console.warn(`NAVIGATION RETRY > ${scenario.label} 重新打开玩法弹层并选择 ${gameTypeTestId}`);
  await clickByTestId(page, 'create-game-button');
  await clickByTestId(page, gameTypeTestId);
  return true;
}

/** 暂停并隐藏视频，避免播放帧不定 */
async function stabilizeVideos(page: Page): Promise<void> {
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
async function stabilizeBackdropFilter(page: Page): Promise<void> {
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
async function alignPersonalHouseTitlesToDevicePixels(page: Page): Promise<void> {
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

export async function preparePage(page: Page, scenario: VisualScenario): Promise<void> {
  await page.waitForSelector('#root', { timeout: 60000 });
  await page.waitForLoadState('load');

  if (!scenario.skipAppReadyCheck) {
    await ensureAppReadyPastStaging(page);
  }

  if (scenario.waitForLoading) {
    await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), undefined, {
      timeout: 60000,
    });
  }

  if (scenario.signIn) {
    // 已注入当前分片开始前采集的登录态。失效时直接终止场景，不能让并行 worker
    // 各自走 UI 登录：同一账号的新 token 会使其它 worker 的 token 立即失效。
    if ((await waitForSignInState(page)) !== 'signedIn') {
      throw new Error(`SIGN-IN > ${scenario.label} 分片登录态未生效，请重新采集后重跑该分片`);
    }
    await dismissSignedInPopups(page);
  }

  // 底部 tab 不只有登录态可访问；游客私人房等场景也需要通过 tab 进入。
  if (scenario.tabTestId) {
    await clickByTestId(page, scenario.tabTestId);
    if (scenario.signIn) {
      await dismissSignedInPopups(page);
    }
  }

  // 页内点击导航（打开登录页、进入「我的」tab 设置子页等）。
  // 必须在此处（宽度锁定等稳定化步骤之前）执行：曾试过在流程末尾点击，
  // 打开的登录 modal 会被随即卸载（排查记录见 scenarios.ts）
  for (const navTestId of scenario.navClickTestIds) {
    await clickByTestId(page, navTestId);
    if (navTestId === 'personal-house-create' || navTestId === 'personal-house-join') {
      // 私人房详情先显示缓存内容，focus 回调随后才进入刷新 skeleton。
      // 留出刷新启动窗口；下一次点击/最终 ready 再等待刷新后的真实内容，
      // 避免截到 skeleton，也减少刷新重渲染吞掉玩法选择导航的概率。
      await page.waitForTimeout(1000);
    }
  }
  if (scenario.navClickTestIds.length > 0) {
    await dismissSignedInPopups(page);
  }

  if (scenario.visualReadySelector) {
    const ready = page.locator(`${scenario.visualReadySelector}:visible`).last();
    try {
      await ready.waitFor({ state: 'attached', timeout: 60000 });
    } catch (error) {
      if (!(await retryCreateRoomNavigation(page, scenario))) {
        await dumpPageState(page, 'visualReadySelector timeout');
        throw error;
      }
      await ready.waitFor({ state: 'attached', timeout: 60000 });
    }
    await ready.scrollIntoViewIfNeeded().catch(() => undefined);
  }

  // 过渡弹层（如选玩法 BottomSheet）：选中后导航可能打断 dismiss，DOM 残留须主动清掉
  if (scenario.visualGoneSelector) {
    await ensureSelectorGone(page, scenario.visualGoneSelector);
  }

  if (scenario.readyText) {
    try {
      await page.getByText(scenario.readyText, { exact: true }).first().waitFor({
        state: 'attached',
        timeout: 60000,
      });
    } catch (error) {
      await dumpPageState(page, 'readyText timeout');
      throw error;
    }
  }

  // 仅大厅本身依赖牌局注码。底部 tab 会保留大厅的 DOM；若对所有页面全局等待，
  // 远端牌局接口慢/失败会让消息、私人房、我的等无关场景各白等一分钟。
  if (
    scenario.pageLabel === 'hall' ||
    scenario.pageLabel === 'signed_in_hall' ||
    scenario.pageLabel === 'signed_in_hall_match'
  ) {
    await page.waitForFunction(
      () => {
        const nodes = Array.from(
          document.querySelectorAll(
            '[data-testid="match-game-bet-info"], [data-testid="match-game-minimum-chip"]',
          ),
        ).filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
          );
        });
        // 德州、炸金花各 4 张房卡，每张有盲注/带入两处动态文案，共 16 个。
        // 只等到 8 个会在第一组刚完成时提前截图，使第二组仍显示 "--"。
        return nodes.length >= 16 && nodes.every((el) => el.textContent?.trim() !== '--');
      },
      undefined,
      { timeout: 60000 },
    );
  }

  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // 等图片加载完成，10s 兜底（个别懒加载图片可能永不触发 load/error）
  await ensureLocalImagesLoaded(page);

  // 锁定页面宽度，避免横向溢出导致截图尺寸漂移
  await lockPageWidth(page, scenario.viewport.width);

  await stabilizeVideos(page);
  await stabilizeBackdropFilter(page);
  await alignPersonalHouseTitlesToDevicePixels(page);
  await applyContentStabilizers(page, scenario);
  // 页面就绪及图片等待期间仍可能有异步请求失败 Alert 晚到；截图前最后清理一次。
  // 未登录的协议/隐私页同样会收到代理探测失败 Alert，因此所有场景都要执行。
  await dismissSignedInPopups(page);
  if (scenario.resetScrollSelector) {
    await resetScrollToStart(page, scenario.resetScrollSelector);
  }
  // 不再额外 delay：toHaveScreenshot 自带「连续两帧一致才截图」的稳定等待
}
