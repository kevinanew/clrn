import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import { appliedGameTranslation, gameViewportCorrection } from '../texas-holdem/viewportAlignment';

export const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();
export const advance = (page: Page) => page.clock.runFor(1200);
/** 座位引导箭头使用 JS transform 循环，CSS 禁动画无法停止；固定其初始位置。 */
export async function stabilizeSeatGuides(page: Page): Promise<void> {
  const selector = 'div:has(> [data-testid="zhajinhua-seat-sit-text"]) > :first-child > :first-child';
  await page.addStyleTag({ content: `${selector} { transform: none !important; }` });
  const arrows = page.locator(selector);
  await expect(arrows).toHaveCount(9);
  for (const arrow of await arrows.all()) {
    await expect(arrow).toHaveCSS('transform', 'none');
    await expect(arrow).toHaveCSS('width', '24px');
    await expect(arrow).toHaveCSS('height', '20px');
  }
}
export async function click(page: Page, id: string): Promise<void> {
  await visible(page, id).click();
}
export async function menu(page: Page, item: string, ready: string): Promise<void> {
  await click(page, 'menu-button');
  await expect(visible(page, 'drawer-menu-item-exit')).toBeVisible();
  await click(page, `drawer-menu-item-${item}`);
  await expect(visible(page, 'drawer-menu-item-exit')).toBeHidden();
  await expect(visible(page, ready)).toBeVisible();
}
export async function closeMask(page: Page, marker: string, advanceClock = false): Promise<void> {
  await visible(page, marker)
    .locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]')
    .locator(':scope > [data-testid="screen-mask-touch-to-close"]')
    .evaluate(node => (node as HTMLElement).click());
  if (advanceClock) await advance(page);
  await expect(visible(page, marker)).toBeHidden();
}

/** 归零导航滚动，仅允许已知的四像素偏移，缺图或更大位移必须报错。 */
export async function capture(page: Page, scenario: VisualScenario, state: string): Promise<void> {
  const game = visible(page, 'run-game-view');
  await game.evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  const { top, translate } = await game.evaluate(node => ({
    top: node.getBoundingClientRect().top, translate: (node as HTMLElement).style.getPropertyValue('translate'),
  }));
  const correction = gameViewportCorrection(top, appliedGameTranslation(translate));
  await game.evaluate((node, amount) => {
    (node as HTMLElement).style.setProperty('translate', `0 ${amount}px`, 'important');
  }, correction);
  await ensureLocalImagesLoaded(page);
  await expect(page).toHaveScreenshot(`${scenario.label}_${state}.png`, { timeout: 20_000 });
  console.log(`ZHAJINHUA SNAPSHOT > ${scenario.label}_${state}`);
}
