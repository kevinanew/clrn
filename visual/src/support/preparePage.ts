/**
 * 截图前的页面准备：
 * 过 staging 弹窗、登录态确认、tab/子页导航、就绪等待、渲染稳定化、
 * 易变文本固定填充。
 */
import type { Page } from '@playwright/test';
import { clickByTestId, retryCreateRoomNavigation, ensureSelectorGone, resetScrollToStart } from './preparePageNavigation';
export { ensureSelectorGone, resetScrollToStart, revealVirtualizedSettingsItem } from './preparePageNavigation';
import type { VisualScenario } from '../../scenarioTypes';
import { stabilizeVideos, stabilizeBackdropFilter, alignPersonalHouseTitlesToDevicePixels, applyContentStabilizers, assertMatchingArtworkVisible, ensureLocalImagesLoaded, lockPageWidth, scrollVisualReadyElementIntoView } from './pageStabilizers';
import { accountPresentationRules } from '../../cases/account/presentation';
import { privateRoomPresentationRules } from '../../cases/private-room/presentation';
export { applyContentStabilizers, ensureLocalImagesLoaded, lockPageWidth } from './pageStabilizers';
import {
  dismissSignedInPopups,
  dumpPageState,
  ensureAppReadyPastStaging,
  waitForSignInState,
} from './authFlow';

/**
 * 等待应用和认证就绪，执行场景导航与滚动定位，准备最终截图。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 */
export async function preparePage(page: Page, scenario: VisualScenario): Promise<void> {
  await page.waitForSelector('#root', { timeout: 60000 });
  await page.waitForLoadState('load');

  await waitForApp(page, scenario);
  await validateScenarioSignIn(page, scenario);
  await navigateScenarioTab(page, scenario);
  await navigateScenarioPages(page, scenario);
  await waitForVisualSelector(page, scenario);
  await dismissScenarioOverlay(page, scenario);
  await waitForScenarioText(page, scenario);
  await waitForHallBets(page, scenario);

  await page.evaluate(/** 等待浏览器字体资源就绪，避免截图使用临时后备字体。 */ async () => {
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
  await applyContentStabilizers(page, { ...scenario,
    fixedTexts: [...scenario.fixedTexts, ...await accountPresentationRules(page, scenario),
      ...await privateRoomPresentationRules(page, scenario)] });
  // 页面就绪及图片等待期间仍可能有异步请求失败 Alert 晚到；截图前最后清理一次。
  // 未登录的协议/隐私页同样会收到代理探测失败 Alert，因此所有场景都要执行。
  await dismissSignedInPopups(page);
  if (scenario.resetScrollSelector) {
    await resetScrollToStart(page, scenario.resetScrollSelector);
  }
  if (['hall', 'signed_in_hall', 'signed_in_hall_match'].includes(scenario.pageLabel)) {
    await assertMatchingArtworkVisible(page);
  }
  // 不再额外 delay：toHaveScreenshot 自带「连续两帧一致才截图」的稳定等待
}

/** 等待启动大厅和场景要求的加载完成。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function waitForApp(page: Page, scenario: VisualScenario): Promise<void> {
  if (!scenario.skipAppReadyCheck) {
    await ensureAppReadyPastStaging(page);
  }

  if (scenario.waitForLoading) {
    await page.waitForFunction(/** 等待场景初始化的加载指示消失。 */ () => !document.querySelector('[role="progressbar"]'), undefined, {
      timeout: 60000,
    });
  }
}

/** 验证已注入的真实登录态，失效时直接终止分片场景。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function validateScenarioSignIn(page: Page, scenario: VisualScenario): Promise<void> {
  if (scenario.signIn) {
    // 已注入当前分片开始前采集的登录态。失效时直接终止场景，不能让并行 worker
    // 各自走 UI 登录：同一账号的新 token 会使其它 worker 的 token 立即失效。
    if ((await waitForSignInState(page)) !== 'signedIn') {
      throw new Error(`SIGN-IN > ${scenario.label} 分片登录态未生效，请重新采集后重跑该分片`);
    }
    await dismissSignedInPopups(page);
  }
}

/** 打开底部页签，并为登录场景清理可能的遮挡。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function navigateScenarioTab(page: Page, scenario: VisualScenario): Promise<void> {
  // 底部 tab 不只有登录态可访问；游客私人房等场景也需要通过 tab 进入。
  if (scenario.tabTestId) {
    await clickByTestId(page, scenario.tabTestId);
    if (scenario.signIn) {
      await dismissSignedInPopups(page);
    }
  }
}

/** 依次点击场景入口，在稳定化之前完成子页导航。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function navigateScenarioPages(page: Page, scenario: VisualScenario): Promise<void> {
  // 页内点击导航（打开登录页、进入「我的」tab 设置子页等）。
  // 必须在此处（宽度锁定等稳定化步骤之前）执行：曾试过在流程末尾点击，
  // 打开的登录 modal 会被随即卸载（排查记录见 scenarios.ts）
  for (const navTestId of scenario.navClickTestIds) await navigateScenarioItem(page, navTestId);
  if (scenario.navClickTestIds.length > 0) {
    await dismissSignedInPopups(page);
  }
}

/** 仅在场景声明就绪选择器时等待目标节点。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function waitForVisualSelector(page: Page, scenario: VisualScenario): Promise<void> {
  if (scenario.visualReadySelector) await waitForReadySelector(page, scenario);
}

/** 等待真实就绪节点，建房表单仅允许原有一次恢复。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function waitForReadySelector(page: Page, scenario: VisualScenario): Promise<void> {
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
  await scrollVisualReadyElementIntoView(ready).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
}

/** 清理场景指定的过渡弹层及其背景。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function dismissScenarioOverlay(page: Page, scenario: VisualScenario): Promise<void> {
  // 过渡弹层（如选玩法 BottomSheet）：选中后导航可能打断 dismiss，DOM 残留须主动清掉
  if (scenario.visualGoneSelector) {
    await ensureSelectorGone(page, scenario.visualGoneSelector);
  }
}

/** 等待场景指定文案，超时保留现场诊断。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function waitForScenarioText(page: Page, scenario: VisualScenario): Promise<void> {
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
}

/** 仅为大厅场景等待全部十六处盲注和带入文案。
 * @param page - 当前页面。
 * @param scenario - 当前视觉场景。 */
async function waitForHallBets(page: Page, scenario: VisualScenario): Promise<void> {
  // 仅大厅本身依赖牌局注码。底部 tab 会保留大厅的 DOM；若对所有页面全局等待，
  // 远端牌局接口慢/失败会让消息、私人房、我的等无关场景各白等一分钟。
  if (['hall', 'signed_in_hall', 'signed_in_hall_match'].includes(scenario.pageLabel)) {
    await page.waitForFunction(
      /** 等待大厅全部可见房卡的盲注和带入文案完成真实数据填充。 */ () => {
        const nodes = Array.from(
          document.querySelectorAll(
            '[data-testid="match-game-bet-info"], [data-testid="match-game-minimum-chip"]',
          ),
        ).filter(/** 根据样式、尺寸与视口交集筛选本次大厅可见的房卡数据节点。
 * @param el - 当前匹配的页面元素。 */ (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return [style.display !== 'none', style.visibility !== 'hidden', Number(style.opacity) !== 0,
            rect.width > 0, rect.height > 0, rect.bottom > 0, rect.right > 0,
            rect.top < window.innerHeight, rect.left < window.innerWidth].every(Boolean);
        });
        // 德州、炸金花各 4 张房卡，每张有盲注/带入两处动态文案，共 16 个。
        // 只等到 8 个会在第一组刚完成时提前截图，使第二组仍显示 "--"。
        return nodes.length >= 16 && nodes.every(/** 确认所有条目均满足：`el.textContent?.trim() !== '--'`。
 * @param el - 当前匹配的页面元素。 */ (el) => el.textContent?.trim() !== '--');
      },
      undefined,
      { timeout: 60000 },
    );
  }
}

/** 单次导航后为私人房刷新保留一秒启动窗口。
 * @param page - 当前页面。
 * @param navTestId - 当前导航入口。 */
async function navigateScenarioItem(page: Page, navTestId: string): Promise<void> {
  await clickByTestId(page, navTestId);
  if (navTestId === 'personal-house-create' || navTestId === 'personal-house-join') {
    // 私人房详情先显示缓存内容，focus 回调随后才进入刷新 skeleton。
    // 留出刷新启动窗口；下一次点击/最终 ready 再等待刷新后的真实内容，
    // 避免截到 skeleton，也减少刷新重渲染吞掉玩法选择导航的概率。
    await page.waitForTimeout(1000);
  }
}
