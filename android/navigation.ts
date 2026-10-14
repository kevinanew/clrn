import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';
import { nativeSelector } from './scenarios';
import type { VisualScenario } from '../visual/scenarioTypes';

/**
 * 按原生控件定位；目标在列表下方时通过真实滑动寻找。
 * @param device - 专用模拟器连接。
 * @param selector - 目标控件。
 */
export async function reveal(device: AndroidDevice, selector: AndroidSelector): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    try { await device.wait(selector, { timeout: attempt === 0 ? 7000 : 3000 }); return; }
    catch (error) {
      if (attempt === 8) throw error;
      await device.input.swipe({ x: 360, y: 1000 }, [{ x: 360, y: 400 }], 30);
    }
  }
}

/**
 * 点击真实控件；测试环境提示覆盖中央时使用控件内部仍可见的位置。
 * @param device - 专用模拟器连接。
 * @param identifier - 与 Web 共用的 testID。
 */
export async function tap(device: AndroidDevice, identifier: string): Promise<void> {
  console.log(`ANDROID > 点击 ${identifier}`);
  await reveal(device, { res: identifier });
  if (identifier === 'username-or-email-sign-in-button') {
    const { bounds } = await device.info({ res: identifier });
    await device.input.tap({ x: bounds.x + bounds.width - 10, y: bounds.y + bounds.height / 2 });
  } else {
    await device.tap({ res: identifier });
  }
}

/**
 * 返回主标签，避免前一个表单或弹层影响下一场景。
 * @param device - 专用模拟器连接。
 */
export async function returnToTabs(device: AndroidDevice): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    try { await device.wait({ res: 'settings-tab' }, { timeout: 3000 }); return; }
    catch (error) {
      if (attempt === 8) throw error;
      await device.input.press('Back');
    }
  }
}

/**
 * 从主标签按共享步骤进入页面，等待真实就绪控件和转场结束。
 * @param device - 专用模拟器连接。
 * @param scenario - Web 与 Android 共用的业务场景。
 */
export async function navigateScenario(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  await returnToTabs(device);
  await tap(device, scenario.tabTestId || 'hall-tab');
  for (const identifier of scenario.navClickTestIds) {
    if (identifier === 'hall-sign-in-button') {
      await tap(device, 'settings-tab');
      await tap(device, 'sign-in-button');
      await device.wait({ res: 'username-or-email-sign-in-button' });
    } else {
      await tap(device, identifier);
    }
  }
  await reveal(device, nativeSelector(scenario.visualReadySelector));
  if (scenario.visualGoneSelector) {
    await device.wait(nativeSelector(scenario.visualGoneSelector), { state: 'gone' });
  }
  if (scenario.readyText) await device.wait({ text: scenario.readyText });
  // 表单预填文字与 Web 相同，只编辑表单，不提交个人资料或创建房间。
  for (const rule of scenario.fixedTexts) {
    if (/input"\]$/.test(rule.selector)) {
      await device.fill(nativeSelector(rule.selector), rule.text);
      await device.input.press('Back');
    }
  }
}

/**
 * 使用账号池的真实凭据完成原生登录，不注入伪造会话。
 * @param device - 专用模拟器连接。
 */
export async function signIn(device: AndroidDevice): Promise<void> {
  const { VISUAL_USERNAME: username, VISUAL_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error('安卓登录测试必须通过账号池启动。');
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'username-or-email-sign-in-button');
  await device.fill({ res: 'username-input' }, username);
  await device.fill({ res: 'password-input' }, password);
  await device.input.press('Back');
  await tap(device, 'sign-in-button');
  await device.wait({ res: 'settings-tab' }, { timeout: 60_000 });
  await tap(device, 'settings-tab');
  await expect(async () => {
    await device.wait({ res: 'user-info-button' }, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * 通过应用语言设置选择与 Web 相同的语言，保留系统的固定英文显示条件。
 * @param device - 专用模拟器连接。
 * @param locale - 应用语言代码。
 */
export async function selectLanguage(device: AndroidDevice, locale: string): Promise<void> {
  const identifier = { en: 'english', 'zh-Hans': 'zh-hans', 'zh-Hant': 'zh-hant' }[locale];
  if (!identifier) throw new Error(`不支持的测试语言：${locale}`);
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'switch-language-button');
  await tap(device, identifier);
  await tap(device, 'confirm-button');
  await device.wait({ res: 'switch-language-container' }, { state: 'gone', timeout: 30_000 });
  await returnToTabs(device);
}
