import { expect, test, type Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';

/**
 * 保留原截图断言，仅在失败后附加德州高级建房页或游客账号页绘制诊断。
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
 * @param page - 发生缺图差异的页面。
 * @param pageLabel - 仅为德州高级建房页或游客账号页保存诊断。
 */
async function attachArtworkDiagnostics(page: Page, pageLabel: string): Promise<void> {
  if (pageLabel !== 'signed_in_create_room_advanced_texas' && pageLabel !== 'guest_me') return;
  try {
    const body = await page.evaluate(/** 只读取 SVG 几何及绘制定义的计数。 */ () =>
      ({ layout: ['base-create-room-screen', 'advanced-options-button', 'operation-duration-title-text'].map(/** 只读取固定标记及祖先的几何，不记录页面文本或属性。
       * @param testId - 固定标记。 */ testId => {
        const element = Array.from(document.querySelectorAll(`[data-testid="${testId}"]`)).find(
          /** 查找当前可见的固定标记元素。
           * @param node - 待检查的元素。 */ node => node.checkVisibility(),
        );
        const ancestors = [];
        for (let node: Element | null = element ?? null; node && ancestors.length < 12; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          ancestors.push({ top: rect.top, height: rect.height, scrollTop: node.scrollTop,
            scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
            overflowY: style.overflowY, position: style.position });
        }
        return { testId, ancestors };
      }), svg: Array.from(document.querySelectorAll('svg')).slice(0, 100).map(/** 保留隐藏 SVG 作为重复引用的对照。
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
      })) }));
    const name = pageLabel === 'guest_me' ? 'account-artwork-diagnostics' : 'private-room-artwork-diagnostics';
    await test.info().attach(name, { body: JSON.stringify(body), contentType: 'application/json' });
  } catch { /* 诊断失败不得替换原始截图异常。 */ }
}
