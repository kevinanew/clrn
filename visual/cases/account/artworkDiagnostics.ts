import { expect, test, type Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';

/**
 * 保留原截图断言，仅在失败后附加游客账号页绘制诊断。
 * @param page - 当前页面。
 * @param scenario - 原截图场景。
 */
export async function screenshotWithArtworkDiagnostics(page: Page, scenario: VisualScenario): Promise<void> {
  try { await expect(page).toHaveScreenshot(`${scenario.label}.png`); }
  catch (error) {
    await attachArtworkDiagnostics(page, scenario.pageLabel);
    throw error;
  }
}

/**
 * 失败后只读记录 SVG 绘制定义的重复数与可见性，不输出地址、标识或页面正文。
 * @param page - 发生缺图差异的账号页。
 * @param pageLabel - 仅为游客账号页保存诊断。
 */
async function attachArtworkDiagnostics(page: Page, pageLabel: string): Promise<void> {
  if (pageLabel !== 'guest_me') return;
  try {
    const body = await page.evaluate(/** 只读取 SVG 几何及绘制定义的计数。 */ () =>
      Array.from(document.querySelectorAll('svg')).slice(0, 100).map(/** 保留隐藏 SVG 作为重复引用的对照。
       * @param svg - 当前 SVG。 */ svg => ({
        visible: svg.checkVisibility(),
        width: svg.getBoundingClientRect().width,
        height: svg.getBoundingClientRect().height,
        references: svg.querySelectorAll('[fill*="url("], [stroke*="url("]').length,
        definitions: Array.from(svg.querySelectorAll('linearGradient, radialGradient, clipPath, mask'))
          .map(/** 只统计同名定义，不输出原始标识。
           * @param definition - 当前绘制定义。 */ definition => ({
            matches: document.querySelectorAll(`[id="${CSS.escape(definition.id)}"]`).length,
            stops: definition.querySelectorAll('stop').length,
          })),
      })));
    await test.info().attach('account-artwork-diagnostics', { body: JSON.stringify(body), contentType: 'application/json' });
  } catch { /* 诊断失败不得替换原始截图异常。 */ }
}
