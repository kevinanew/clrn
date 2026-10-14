import type { AndroidDevice } from 'playwright';
import type { VisualScenario } from '../visual/scenarioTypes';
import { adb } from './device';
import { dismissKeyboard } from './keyboard';
import { nativeSelector } from './scenarios';

/**
 * 用正常滚动和输入设置与 Web 相同的表单文字，不提交表单。
 * @param device - 专用模拟器连接。
 * @param scenario - 共用场景中的预填文字。
 */
export async function fillScenarioInputs(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  for (const rule of scenario.fixedTexts.filter(item => /input"\]$/.test(item.selector))) {
    const selector = nativeSelector(rule.selector);
    for (let attempt = 0; attempt < 9; attempt++) {
      const node = await device.info(selector).catch(() => undefined);
      if (node && node.bounds.height > 0 && node.bounds.y >= 176 && node.bounds.y + node.bounds.height <= 1232) break;
      const scrollable = await device.info({ scrollable: true }).catch(() => undefined);
      if (!scrollable) break;
      const { x, y, width, height } = scrollable.bounds;
      const horizontal = String(Math.round(x + Math.min(8, width * 0.02)));
      adb('shell', 'input', 'swipe', horizontal, String(Math.round(y + height * 0.2)),
        horizontal, String(Math.round(y + height * 0.85)), '600');
    }
    // 原生 fill 的内部点击不会等待异步表单挂载，必须先确认输入框已出现。
    await device.wait(selector);
    await device.fill(selector, rule.text);
    await dismissKeyboard(device);
  }
}
