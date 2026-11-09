/** 场景导航、虚拟列表及残留弹层的页面准备，保持原有重试和超时。 */
import type { Locator, Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';

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
 * @param page - 执行操作的 Playwright 页面。
 * @param selector - 待操作元素的 CSS 选择器。
 */
export async function ensureSelectorGone(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  if (await selectorHidden(target)) return;

  await dismissBackdrop(page);

  try {
    await target.waitFor({ state: 'hidden', timeout: 5000 });
    return;
  } catch {
    // continue
  }

  await page.evaluate(/** 隐藏残留弹层及其遮罩，避免导航后截图被透明拦截层遮挡。
 * @param goneSelector - 当前操作使用的 goneSelector。 */ (goneSelector: string) => {
    const backdrops = {
      /** 隐藏弹窗背景，从父节点开始避免隐藏整个应用。
       * @param parent - 匹配节点的父节点。 */
      hide(parent: HTMLElement | null): void {
        parent?.closest<HTMLElement>('[data-testid="popup-backdrop"]')?.style.setProperty('display', 'none', 'important');
      },
    };
    document.querySelectorAll(goneSelector).forEach(/** 隐藏匹配节点及所属弹层面板、弹窗背景，保留应用根节点。
 * @param el - 当前匹配的页面元素。 */ (el) => {
      const node = el as HTMLElement;
      node.style.setProperty('display', 'none', 'important');

      node.closest<HTMLElement>('[aria-label="Bottom Sheet"]')?.style.setProperty('display', 'none', 'important');
      backdrops.hide(node.parentElement);
    });
    document.querySelectorAll('[role="button"][aria-label*="backdrop" i]').forEach(/** 隐藏仍然存在的背景按钮，解除残留遮罩的点击拦截。
 * @param el - 当前匹配的页面元素。 */ (el) => {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
    });
  }, selector);

  await target.waitFor({ state: 'hidden', timeout: 5000 });
}

/**
 * SectionList 在 RN Web 上会虚拟化列表项；「我的」页的商城等项目在首屏外时，
 * 对尚未挂载的 testID 调用 scrollIntoViewIfNeeded 无效。主动滚动 settings-list，
 * 让目标 cell 进入 DOM 后再点击。
 * @param page - 执行操作的 Playwright 页面。
 * @param target - 待滚动、侧滑或验证的元素定位器。
 */
export async function revealVirtualizedSettingsItem(page: Page, target: Locator): Promise<void> {
  // React Navigation 会保留非活动 tab 的 DOM；必须滚动当前可见列表，否则可能一直
  // 操作隐藏的旧 settings-list，目标 cell 永远不会进入 DOM。
  const settingsList = page.locator('[data-testid="settings-list"]:visible').last();
  if (!(await settingsList.count())) {
    return;
  }

  await scrollSettingsUntilMounted(page, settingsList, target);
}

/**
 * 恢复指定可见滚动容器的首屏位置。
 *
 * RN Web 的异步图片/列表布局可能让 scrollIntoViewIfNeeded 先按临时高度滚动，
 * 随后内容收缩却保留 scrollTop，最终把页面顶部内容裁出截图。复位后派发 scroll，
 * 让 FlatList 同步虚拟化窗口，再等两帧完成布局。
 * @param page - 执行操作的 Playwright 页面。
 * @param selector - 待操作元素的 CSS 选择器。
 */
export async function resetScrollToStart(page: Page, selector: string): Promise<void> {
  const scrollContainer = page.locator(`${selector}:visible`).last();
  if (!(await scrollContainer.count())) {
    return;
  }

  await scrollContainer.evaluate(/** 复位目标容器的横纵滚动位置，并通知虚拟列表更新。
 * @param el - 当前匹配的页面元素。 */ (el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.evaluate(
    /** 在页面中读取`new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); })`，供测试判断当前界面状态。 */ () =>
      new Promise<void>(/** 等待两个渲染帧，让滚动复位后的布局稳定。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => {
        requestAnimationFrame(/** 推进渲染帧等待，在浏览器完成本帧布局后继续。 */ () => requestAnimationFrame(/** 推进渲染帧等待，在浏览器完成本帧布局后继续。 */ () => resolve()));
      }),
  );
}

/**
 * 点击 data-testid 元素并等待页面稳定（loading 消失）；被遮罩拦截时降级为 JS click
 * @param page - 执行操作的 Playwright 页面。
 * @param testId - 目标元素的测试标记。
 */
export async function clickByTestId(page: Page, testId: string): Promise<void> {
  // 嵌套导航会留下同 testID 的隐藏节点；点击当前可见节点可避免无意义的超时与 JS 降级。
  const target = page.locator(`[data-testid="${testId}"]:visible`).last();
  // 常规节点会立即挂载；超过短暂初始化期仍不存在时，尝试唤醒「我的」页的虚拟列表项。
  await target.waitFor({ state: 'attached', timeout: 3000 }).catch(/** 目标首次等待失败时滚动设置列表，使虚拟化入口挂载。 */ async () => {
    await revealVirtualizedSettingsItem(page, target);
  });
  await target.waitFor({ state: 'attached', timeout: 60000 });
  // 必须显式限时：对 Playwright 误判不可见的元素该调用会无限等待
  await target.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
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
      .evaluate(/** 在页面中查找最后一个真实可见的目标节点并派发点击。
 * @param id - 当前操作使用的 id。 */ (id: string) => {
        const candidates = Array.from(
          document.querySelectorAll(`[data-testid="${CSS.escape(id)}"]`),
        ) as HTMLElement[];
        const visible = candidates.filter(/** 根据样式和布局尺寸筛选仍在展示的目标元素。
 * @param el - 当前匹配的页面元素。 */ (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return [style.display !== 'none', style.visibility !== 'hidden', Number(style.opacity) !== 0,
            rect.width > 0, rect.height > 0].every(Boolean);
        });
        const current = visible.at(-1);
        current?.click();
        return Boolean(current);
      }, testId)
      .catch(/** 将检测失败视为条件不满足，交由调用方选择后续分支。 */ () => false);
    if (!clicked) {
      console.log(`DEBUG > click "${testId}" 后节点已卸载，按已触发导航继续`);
    }
  }
  await page.waitForTimeout(250);
  await page
    .waitForFunction(/** 等待进度条消失，确认点击后的页面加载完成。 */ () => !document.querySelector('[role="progressbar"]'), undefined, {
      timeout: 60000,
    })
    .catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
}

/**
 * 选玩法弹层的 onPress 偶尔会完成 dismiss 却丢失 navigate，页面回到私人房详情。
 * 仅对建房表单场景重开弹层并重选一次；其它页面仍直接暴露真实导航失败。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 */
export async function retryCreateRoomNavigation(page: Page, scenario: VisualScenario): Promise<boolean> {
  const gameTypeTestId = scenario.navClickTestIds.find(/** 查找满足以下条件的首个条目：`testId.startsWith('game-type-button-')`。
 * @param testId - 当前操作使用的 testId。 */ (testId) =>
    testId.startsWith('game-type-button-'),
  );
  if (!gameTypeTestId) {
    return false;
  }

  if (!await reopenCreateRoom(page, scenario)) return false;

  console.warn(`NAVIGATION RETRY > ${scenario.label} 重新打开玩法弹层并选择 ${gameTypeTestId}`);
  await clickByTestId(page, 'create-game-button');
  await clickByTestId(page, gameTypeTestId);
  return true;
}

/** 等待弹层自行关闭，超时后允许原有的点击兜底。
 * @param target - 弹层定位器。 */
async function selectorHidden(target: Locator): Promise<boolean> {
  try { await target.waitFor({ state: 'hidden', timeout: 5000 }); return true; }
  catch { return false; }
}

/** 优先点 BottomSheet 背景，否则发送 Escape。
 * @param page - 当前页面。 */
async function dismissBackdrop(page: Page): Promise<void> {
  const backdrop = page.getByRole('button', { name: /Bottom sheet backdrop/i }).first();
  if (await backdrop.isVisible().catch(/** 将检测失败视为条件不满足，交由调用方选择后续分支。 */ () => false)) {
    await backdrop.click({ force: true }).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
  } else {
    await page.keyboard.press('Escape').catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
  }
}

/** 保留最多十二次分段滚动与每次 150ms 等待。
 * @param page - 当前页面。
 * @param settingsList - 当前可见设置列表。
 * @param target - 需要挂载的目标。 */
async function scrollSettingsUntilMounted(page: Page, settingsList: Locator, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await target.count()) {
      return;
    }
    await settingsList
      .evaluate(/** 分段滚动当前设置列表并派发事件，唤醒尚未挂载的虚拟列表项。
 * @param el - 当前匹配的页面元素。 */ (el) => {
        const node = el as HTMLElement;
        node.scrollTop += Math.max(node.clientHeight * 0.75, 240);
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      })
      .catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
    await page.waitForTimeout(150);
  }
}

/** 在私人房详情中恢复建房入口，未出现入口时拒绝重试。
 * @param page - 当前页面。 */
async function reopenCreateGame(page: Page): Promise<boolean> {
  const createGameVisible = await page
    .locator('[data-testid="create-game-button"]:visible')
    .last()
    .isVisible()
    .catch(/** 将检测失败视为条件不满足，交由调用方选择后续分支。 */ () => false);
  if (createGameVisible) return true;
  return reopenPersonalHouse(page);
}

/** 打开私人房建房入口。
 * @param page - 当前页面。 */
async function reopenPersonalHouse(page: Page): Promise<boolean> {
  const personalHouseCreateVisible = await page
    .locator('[data-testid="personal-house-create"]:visible')
    .last()
    .isVisible()
    .catch(/** 将检测失败视为条件不满足，交由调用方选择后续分支。 */ () => false);
  if (!personalHouseCreateVisible) {
    return false;
  }
  await clickByTestId(page, 'personal-house-create');
  return true;
}

/** 只允许建房表单恢复入口，其他页面保持原有导航错误。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function reopenCreateRoom(page: Page, scenario: VisualScenario): Promise<boolean> {
  if (!scenario.pageLabel.startsWith('signed_in_create_room_form')) return false;
  return reopenCreateGame(page);
}
