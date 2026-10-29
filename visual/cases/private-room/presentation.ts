import type { Page } from '@playwright/test';
import type { FixedTextRule, VisualScenario } from '../../scenarioTypes';
import presentation from '../../fixtures/game-presentation.json';

/**
 * 固定私人房页的房号展示，保留本地化标签、复制图标和真实房屋响应。
 * @param page - 已完成导航的页面。
 * @param scenario - 当前视觉场景。
 */
export async function privateRoomPresentationRules(page: Page, scenario: VisualScenario): Promise<FixedTextRule[]> {
  if (!scenario.signIn || scenario.group !== 'private-room') return [];
  const button = page.getByTestId('copy-house-number-button').filter({ visible: true });
  if (await button.count() === 0) return [];
  const selector = '[data-testid="copy-house-number-button"] [dir="auto"]';
  const text = await button.locator('[dir="auto"]').innerText();
  if (!/\b\d{9}\b/.test(text)) throw new Error('私人房页必须先显示真实的九位房号');
  return [{ selector, text: text.replace(/\b\d{9}\b/, presentation.roomNumber) }];
}
