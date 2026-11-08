/** 真实浏览器验证引导按钮与应用存储的边界，不访问业务服务。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '../src/support/diagnosticTest';
import { installTutorialHandler } from '../../e2e/helpers/tutorials';

for (const [locale, skip, finish] of [['zh-Hans', '跳过', '完成'], ['zh-Hant', '跳過', '完成'], ['en', 'Skip', 'Finish']]) {
  test(`${locale} 引导通过真实点击完成，延迟引导与业务按钮互不干扰`, /** 验证$\{locale\} 引导通过真实点击完成，延迟引导与业务按钮互不干扰。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
    await page.goto(pathToFileURL(path.join(__dirname, 'fixtures/tutorials.html')).href);
    await installTutorialHandler(page);
    await installTutorialHandler(page);
    await page.evaluate(/** 绑定真实业务按钮，验证引导关闭后点击能够到达业务。 */ () => {
      document.getElementById('business')!.onclick = /** 记录真实业务点击。 */ () => { document.body.dataset.clicked = 'true'; };
    });
    await page.locator('#business').click();
    expect(await page.evaluate(/** 在页面中读取`localStorage.length`，供测试判断当前界面状态。 */ () => localStorage.length)).toBe(0);

    for (const [index, name] of ['hall', 'personal.house', 'create.room'].entries()) {
      const key = `${name}.screen.tutorial.complete.key`;
      const label = index === 1 ? finish : skip;
      expect(await page.evaluate(/** 在页面中读取`localStorage.getItem(key)`，供测试判断当前界面状态。
 * @param key - 当前操作使用的 key。 */ key => localStorage.getItem(key), key)).toBeNull();
      // 同构于 react-native-copilot 3.3.3：说明与按钮位于 tooltip 的两个子容器。
      await page.evaluate(/** 构造没有标准测试标记的引导按钮，验证受限后备定位。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ label, key, finish }) => {
        const guide = document.getElementById('guide')!;
        guide.innerHTML = '<div><span data-testid="stepDescription">引导</span></div><div><div tabindex="0"><span style="pointer-events:none"></span></div></div>';
        const button = guide.querySelector<HTMLElement>('[tabindex]')!;
        button.dataset.testid = label === finish ? 'tooltip-finish-button' : 'tooltip-skip-button';
        button.querySelector('span')!.textContent = label;
        button.onclick = /**
         * 只有可信输入才能触发应用的完成状态保存。
         * @param event - 浏览器实际分发的点击事件。
         */ event => {
          if (!event.isTrusted) throw new Error('引导必须来自真实输入');
          localStorage.setItem(key, 'true');
          guide.replaceChildren();
        };
      }, { label, key, finish });
      // 静态大厅可能直接断言后截图，不能依赖业务点击才处理引导。
      await expect(page.locator('#business')).toBeVisible();
      await expect(page.getByTestId('stepDescription')).toHaveCount(0);
      expect(await page.evaluate(/** 在页面中读取`localStorage.getItem(key)`，供测试判断当前界面状态。
 * @param key - 当前操作使用的 key。 */ key => localStorage.getItem(key), key)).toBe('true');
      await page.locator('#business').click();
    }
    await expect(page.locator('body')).toHaveAttribute('data-clicked', 'true');
    expect(await page.evaluate(/** 在页面中读取`localStorage.length`，供测试判断当前界面状态。 */ () => localStorage.length)).toBe(3);

    // 业务弹窗即使有同名按钮，也不能被处理器确认或移除。
    await page.evaluate(/** 创建带本地化跳过按钮的模态引导，验证不同语言处理。
 * @param skip - 当前操作使用的 skip。 */ skip => {
      const dialog = document.createElement('dialog');
      dialog.innerHTML = `<button>${skip}</button>`;
      document.body.append(dialog);
      dialog.showModal();
    }, skip);
    await expect(page.locator('#business').click({ timeout: 500 })).rejects.toThrow(/Timeout/);
    await expect(page.locator('dialog')).toBeVisible();
  });
}
