import type { Page } from '@playwright/test';
import type { FixedTextRule, VisualScenario } from '../../scenarioTypes';

/**
 * 固定账号页的展示资料，保留既有基准文案；不修改真实认证缓存或接口响应。
 * 日期与用户名标签保留页面本身的翻译，只替换随账号变化的内容。
 * @param page - 已进入账号页的浏览器页面。
 * @param scenario - 当前视觉场景，其他页面不添加账号资料规则。
 * @returns 交给现有 DOM 稳定化观察器持续应用的展示规则。
 */
export async function accountPresentationRules(page: Page, scenario: VisualScenario): Promise<FixedTextRule[]> {
  if (!scenario.signIn) return [];
  if (scenario.pageLabel === 'signed_in_me') {
    const username = await page.getByTestId('username-text').filter({ visible: true }).innerText();
    if (!username.includes('：')) throw new Error('账号页用户名缺少本地化标签分隔符。');
    return [
      { selector: '[data-testid="nickname-text"]', text: 'Venom' },
      { selector: '[data-testid="username-text"]', text: username.replace(/：.*$/u, '：laiwanvisual01') },
    ];
  }
  if (scenario.pageLabel === 'signed_in_profile') {
    const joined = await page.getByTestId('profile-join-date').filter({ visible: true }).innerText();
    if (!/\d{4}-\d{2}-\d{2}/.test(joined)) throw new Error('个人资料页缺少有效注册日期。');
    return [
      { selector: '[data-testid="profile-item-0"] [data-testid="content-text-0"]', text: 'Venom' },
      { selector: '[data-testid="profile-item-1"] [data-testid="content-text-1"]', text: 'laiwanvisual01' },
      { selector: '[data-testid="profile-join-date"]', text: joined.replace(/\d{4}-\d{2}-\d{2}/, '2026-07-18') },
    ];
  }
  return [];
}
