import type { Page } from '@playwright/test';
import type { FixedTextRule, VisualScenario } from '../../scenarioTypes';
import presentation from '../../fixtures/account-presentation.json';

/**
 * 固定账号页的展示资料，保留既有基准文案；不修改真实认证缓存或接口响应。
 * 日期与用户名标签保留页面本身的翻译，只替换随账号变化的内容。
 * @param page - 已进入账号页的浏览器页面。
 * @param scenario - 当前视觉场景，其他页面不添加账号资料规则。
 * @returns 交给现有 DOM 稳定化观察器持续应用的展示规则。
 */
export async function accountPresentationRules(page: Page, scenario: VisualScenario): Promise<FixedTextRule[]> {
  if (!scenario.signIn) return [];
  const rules = { signed_in_me: accountRules, signed_in_profile: profileRules };
  const handler = rules[scenario.pageLabel as keyof typeof rules];
  return handler ? handler(page) : [];
}

/**
 * 固定账号摘要，保留翻译标签。
 * @param page - 账号页面。
 */
async function accountRules(page: Page): Promise<FixedTextRule[]> {
  const username = await page.getByTestId('username-text').filter({ visible: true }).innerText();
  if (!username.includes('：')) throw new Error('账号页用户名缺少本地化标签分隔符。');
  return [
    { selector: '[data-testid="nickname-text"]', text: presentation.nickname },
    { selector: '[data-testid="username-text"]', text: username.replace(/：.*$/u, `：${presentation.username}`) },
  ];
}

/**
 * 固定资料页，保留真实日期格式校验。
 * @param page - 资料页面。
 */
async function profileRules(page: Page): Promise<FixedTextRule[]> {
  const joined = await page.getByTestId('profile-join-date').filter({ visible: true }).innerText();
  if (!/\d{4}-\d{2}-\d{2}/.test(joined)) throw new Error('个人资料页缺少有效注册日期。');
  return [
    { selector: '[data-testid="profile-item-0"] [data-testid="content-text-0"]', text: presentation.nickname },
    { selector: '[data-testid="profile-item-1"] [data-testid="content-text-1"]', text: presentation.username },
    { selector: '[data-testid="profile-join-date"]', text: joined.replace(/\d{4}-\d{2}-\d{2}/, presentation.joinedDate) },
  ];
}
