import { fillScenarioInputs } from './form-inputs';
import { exists, waitAbsent } from './native-state';
import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';
import { nativeSelector } from './scenarios';
import type { VisualScenario } from '../visual/scenarioTypes';
import { adb } from './device';
import type { ScreenshotBounds } from './screenshot';

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
      const tutorial = await device.info({ res: 'stepDescription' }).catch(() => undefined);
      if (tutorial) {
        const finish = await device.info({ res: 'tooltip-finish-button' }).catch(() => undefined);
        await device.tap({ res: finish ? 'tooltip-finish-button' : 'tooltip-next-button' });
        if (finish) await waitAbsent(device, { res: 'stepDescription' });
        continue;
      }
      const scrollable = await device.info({ scrollable: true }).catch(() => undefined);
      if (!scrollable) { await device.wait(selector, { timeout: 30_000 }); return; }
      const { bounds } = scrollable;
      // RN 的触摸识别需要连续移动事件；使用容器内的真实 swipe，不用单段手势误触按钮。
      // 滑杆会截获其轨道区域内的拖动；从滚动容器左侧留白发起纵向手势。
      const horizontal = Math.round(bounds.x + Math.min(8, bounds.width * 0.02));
      adb('shell', 'input', 'swipe', String(horizontal), String(Math.round(bounds.y + bounds.height * 0.85)),
        String(horizontal), String(Math.round(bounds.y + bounds.height * 0.2)), '600');
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
  let previousBounds: unknown;
  await expect(async () => {
    const { bounds } = await device.info({ res: identifier });
    const previous = previousBounds;
    previousBounds = bounds;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds, '点击前控件位置必须稳定').toEqual(previous);
  }).toPass({ timeout: 10_000, intervals: [200] });
  const { bounds } = await device.info({ res: identifier });
  const warning = await device.info({ res: 'switch-to-production-tip-container' }).catch(() => undefined);
  const agreement = await device.info({ res: 'user-agreement-title' }).catch(() => undefined);
  const overlapsWarning = [warning, agreement].some(overlay => overlay && bounds.y < overlay.bounds.y + overlay.bounds.height
    && bounds.y + bounds.height > overlay.bounds.y);
  if (identifier === 'username-or-email-sign-in-button' || overlapsWarning) {
    await device.input.tap({ x: bounds.x + bounds.width - 10, y: bounds.y + bounds.height / 2 });
  } else {
    await device.input.tap({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  }
}

/**
 * 返回主标签，避免前一个表单或弹层影响下一场景。
 * @param device - 专用模拟器连接。
 */
export async function returnToTabs(device: AndroidDevice): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    if (await exists(device, { res: 'confirm-pop-up-image-background' })) {
      await tap(device, 'cancel-button');
      await waitAbsent(device, { res: 'confirm-pop-up-image-background' });
      continue;
    }
    // 选玩法弹层会保留底部标签，先正常关闭，不能点击遮罩下的控件。
    const overlay = await exists(device, { res: 'select-game-category-text' }) ? 'select-game-category-text'
      : await exists(device, { res: 'base-create-room-screen' }) ? 'base-create-room-screen' : undefined;
    if (overlay) {
      await device.input.press('Back');
      await waitAbsent(device, { res: overlay });
      continue;
    }
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
export async function navigateScenario(device: AndroidDevice, scenario: VisualScenario): Promise<ScreenshotBounds | undefined> {
  await returnToTabs(device);
  await tap(device, scenario.tabTestId || 'hall-tab');
  const list = await device.info({ scrollable: true }).catch(() => undefined);
  if (list) {
    const { bounds } = list;
    const horizontal = Math.round(bounds.x + bounds.width * 0.95);
    adb('shell', 'input', 'swipe', String(horizontal), String(Math.round(bounds.y + bounds.height * 0.2)),
      String(horizontal), String(Math.round(bounds.y + bounds.height * 0.85)), '150');
  }
  let inputsFilled = false;
  let backgroundBanner: ScreenshotBounds | undefined;
  for (const identifier of scenario.navClickTestIds) {
    if (['search_sign_in_prompt', 'guest_game_sign_in_prompt'].includes(scenario.pageLabel)) {
      // 原生 Dialog 会从无障碍树隐藏背景；在打开之前记录实际横幅边界。
      backgroundBanner = (await device.info({ res: 'slot-banner' }).catch(() => undefined))?.bounds;
    }
    if (identifier === 'advanced-options-button') {
      // 先填写首屏房名再展开下方选项，避免键盘收起后把高级区域滚回首屏。
      await fillScenarioInputs(device, scenario);
      inputsFilled = true;
    }
    if (identifier === 'personal-house-create' || identifier === 'personal-house-join') {
      // 原生私人房标签直接显示房屋详情；共用的创建/加入入口实际位于大厅。
      await tap(device, 'hall-tab');
      await tap(device, identifier);
      if (identifier === 'personal-house-create') {
        await device.wait({ res: 'select-game-category-text' });
        if (!scenario.navClickTestIds.includes('create-game-button')) {
          await device.input.press('Back');
          await waitAbsent(device, { res: 'select-game-category-text' });
        }
      } else await reveal(device, { res: 'copy-house-number-button' });
    } else if (identifier === 'create-game-button' && await exists(device, { res: 'select-game-category-text' })) {
      // 大厅创建入口已经正常打开玩法弹层，不再次点击被遮住的创建按钮。
      continue;
    } else if (identifier === 'hall-sign-in-button') {
      await tap(device, 'settings-tab');
      await tap(device, 'sign-in-button');
      await device.wait({ res: 'username-or-email-sign-in-button' });
    } else {
      await tap(device, identifier);
    }
  }
  if (!inputsFilled) await fillScenarioInputs(device, scenario);
  await reveal(device, nativeSelector(scenario.visualReadySelector));
  if (scenario.visualGoneSelector) {
    await waitAbsent(device, nativeSelector(scenario.visualGoneSelector));
  }
  if (scenario.readyText) await device.wait({ text: scenario.readyText });
  if (scenario.waitForLoading) await waitAbsent(device, { clazz: 'android.widget.ProgressBar' });
  await waitAbsent(device, { res: 'alert-message-text' });
  return backgroundBanner;
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
  await device.wait({ res: 'username-input' });
  await device.fill({ res: 'username-input' }, username);
  await device.input.press('Back');
  await reveal(device, { res: 'password-input' });
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
  await device.wait({ res: 'username-or-email-sign-in-button' }, { timeout: 30_000 });
  const expectedLabel = { en: 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' }[locale];
  await device.wait({ res: 'switch-language-label', text: expectedLabel });
  await tap(device, 'close-user-authentication-button');
  await device.wait({ res: 'settings-tab' });
}
