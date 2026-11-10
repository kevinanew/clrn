import { withMitmproxy } from '../../e2e/helpers/mitmproxy-session';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { bindScenarioProxy } from '../../e2e/helpers/scenario-proxy';
/** 执行独立视觉场景，并在截图前核对场景内容仍然完整可见。 */
import { expect, type Browser } from '@playwright/test';
import type { VisualScenario } from '../scenarioTypes';
import { buildStorageStateForScenario, setupContextForScenario } from '../src/support/pageSetup';
import { preparePage } from '../src/support/preparePage';
import { screenshotWithArtworkDiagnostics } from './private-room/artworkDiagnostics';
import { assertGuestClubReady } from './club/guestReadiness';
import { withAccountValidationDiagnostics } from './accountValidationDiagnostics';

import { visualBaseUrl as baseUrl } from '../target';
const backAccessibilityLabels = {
  'zh-Hans': '返回',
  'zh-Hant': '返回',
  en: 'Back',
};

/**
 * 为单个视觉场景创建隔离上下文，准备页面并执行截图后清理资源。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param browser - 用于创建隔离上下文的浏览器实例。
 * @param options - 可复用的本轮专用代理；缺省为场景启动独立代理。
 */
export async function runVisualScenario(
  scenario: VisualScenario,
  browser: Browser,
  options: { network?: Mitmproxy } = {},
): Promise<void> {
  if (!options.network) return withMitmproxy(/** 在已启动的网络代理范围内运行当前视觉场景。
 * @param network - 当前代理网络配置。 */ network => runVisualScenario(scenario, browser, { network }));
  const context = await browser.newContext({
    viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
    locale: 'en-US',
    deviceScaleFactor: 1,
    storageState: buildStorageStateForScenario(scenario, baseUrl),
    proxy: { server: options.network.server, bypass: '<-loopback>' },
    ignoreHTTPSErrors: true,
  });
  bindScenarioProxy(context, options.network);
  const page = await context.newPage();

  try {
    await withAccountValidationDiagnostics(scenario, context, page, options.network, /** 执行原场景，失败时保存只读诊断。 */ async () => {
    await setupContextForScenario(context, scenario, page);
    await page.goto(scenario.path);
    await preparePage(page, scenario);
    if (scenario.spriteImageCount) {
      const sprites = page.locator('[data-testid="sprite-image-container"]');
      const spriteContents = page.locator('[data-testid="sprite-image-content"]');
      await expect(sprites).toHaveCount(scenario.spriteImageCount);
      await expect(spriteContents).toHaveCount(scenario.spriteImageCount);
      for (let index = 0; index < scenario.spriteImageCount; index += 1) {
        await expect(spriteContents.nth(index)).toHaveCSS('opacity', '1');
      }
    }
    // preparePage 内的稳定化步骤可能耗时较长。截图前再次断言就绪元素仍可见，
    // 避免「更多」菜单等短暂出现后又消失时，被空白页面静默写入视觉基准图。
    await expect(page.locator(`${scenario.visualReadySelector}:visible`).last()).toBeVisible();
    if (scenario.pageLabel === 'guest_club') {
      await assertGuestClubReady(page);
    }
    if (scenario.pageLabel === 'signed_in_club_populated') {
      const list = page.locator('[data-testid="club-list-screen"]:visible').last();
      await expect(list.locator('[data-testid^="club-"][data-testid$="-profile"]'), '我的俱乐部应显示三张卡片')
        .toHaveCount(3);
      await expect(list.getByTestId('club-title'), '三张卡片应展示固定名称').toHaveText([
        '星光俱乐部', '周末俱乐部', '好友俱乐部',
      ]);
      await expect(list.getByTestId('club-member-amount-container'), '卡片应展示各俱乐部成员人数')
        .toHaveText(['18', '36', '72']);
      await expect(list.getByTestId('default-club-avatar-text'), '默认头像应显示俱乐部名称首字')
        .toHaveText(['星', '周', '好']);
      await expect(list.getByTestId('create-room-no-clubs-container'), '有俱乐部时应移除空状态').toHaveCount(0);
      await expect(list.getByTestId('club-list-load-error'), '列表应加载成功').toHaveCount(0);
    }
    if (scenario.pageLabel === 'signed_in_club_rooms_populated') {
      // 大厅也会挂载同一批牌局；断言只检查当前俱乐部页，避免把两处卡片合并计数。
      const clubRoomScreen = page.locator('[data-testid="club-rooms-screen"]:visible').last();
      await expect(clubRoomScreen.locator('[data-testid^="club-room-item-visual-club-room-"]')).toHaveCount(2);
      await expect(clubRoomScreen.locator('[data-testid="club-room-name"]')).toHaveText(['德州体验局', '周末牌局']);
      await expect(clubRoomScreen.locator('[data-testid="club-room-club-name"]')).toHaveText(['演示俱乐部', '演示俱乐部']);
      await expect(clubRoomScreen.locator('[data-testid="club-room-player-count"]')).toHaveText(['2/9', '4/9']);
      await expect(clubRoomScreen.locator('[data-testid="club-rooms-empty-view"]')).toHaveCount(0);
    }
    if (scenario.pageLabel === 'signed_in_daily_bonus') {
      await expect(page.getByTestId('CheckInDateListItem.checkInDetailDate')).toHaveText('01/01');
    }
    if (scenario.pageLabel === 'signed_in_application_management') {
      const visibleBackButton = page
        .locator('[data-testid="navigation-bar-back-image"]:visible')
        .locator('xpath=ancestor::button[1]');
      await expect(visibleBackButton).toHaveCount(1);
      const accessibilityLabel = await visibleBackButton.getAttribute('aria-label');
      expect(accessibilityLabel).toBe(backAccessibilityLabels[scenario.locale]);
    }
    await screenshotWithArtworkDiagnostics(page, scenario);
    });
  } finally {
    await context.close();
  }
}
