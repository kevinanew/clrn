import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { waitForLegacyPrivateHands } from '../cases/game-record/legacyHands';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQtcAAAAASUVORK5CYII=', 'base64');

/**
 * 构造 React Native Web 的背景图和透明辅助图。
 * @param index - 玩家手牌中的槽位。
 * @param face - 辅助图的牌面。
 * @param background - 实际绘制的牌面。
 */
function slot(index: number, face: string, background = face): string {
  return `<div data-testid="hole-card-${index}">
    <div style="width:27px;height:41px;background-image:url(poker_${background}_simple.png)"></div>
    <img style="position:absolute;opacity:0" src="poker_${face}_simple.png">
  </div>`;
}

test('旧版回放等到每位玩家的手牌资源和实际背景均就绪', /** 覆盖尚未加载的资源及已加载但仍画错的背景。
 * @param root0 - 浏览器页面夹具。
 * @param info - 当前测试的隔离输出目录。 */ async ({ page }, info) => {
  const directory = info.outputPath('cards');
  const filename = path.join(directory, 'hands.html');
  await mkdir(directory, { recursive: true });
  await Promise.all(['as', 'ad', 'kh'].map(/** 写入独立的牌面资源。
   * @param card - 牌面标识。 */ card => writeFile(path.join(directory, `poker_${card}_simple.png`), pixel)));
  await writeFile(filename, `<section data-testid="actions">
    <div data-testid="texas-settlement-item">
      <span data-testid="texasPlayerPositionIcon:playerName">Visual Player</span>
      ${slot(0, 'as')}${slot(1, 'ad', 'as')}
    </div>
    <div data-testid="texas-settlement-item">
      <span data-testid="texasPlayerPositionIcon:playerName">Opponent</span>
      ${slot(0, 'kh')}${slot(1, 'ks')}
    </div>
  </section>`);
  await page.goto(pathToFileURL(filename).href);
  const panel = page.getByTestId('actions');
  const missing = panel.getByTestId('hole-card-1').last();
  const artwork = panel.getByTestId('hole-card-1').first().locator('div');
  const correctSource = new URL('poker_ad_simple.png', page.url()).href;
  await expect(missing.locator('img')).toHaveJSProperty('naturalWidth', 0);
  const ready = waitForLegacyPrivateHands(panel, 'actions').then(
    /** 就绪后核对补齐的牌图和原本显示错误的背景。 */ async () => {
      await expect(missing.locator('img')).toHaveJSProperty('naturalWidth', 1, { timeout: 1 });
      await expect(artwork).toHaveCSS('background-image', `url("${correctSource}")`, { timeout: 1 });
    });
  await Promise.all([ready, (/** 补齐缺失资源，然后提交正确背景。 */ async () => {
    await writeFile(path.join(directory, 'poker_ks_simple.png'), pixel);
    await missing.evaluate(/** 重新请求原本缺失的牌图。
     * @param slot - 缺图的牌槽。 */ slot => {
      const image = slot.querySelector('img')!;
      image.src += '?loaded';
      slot.querySelector('div')!.style.backgroundImage = `url("${image.src}")`;
    });
    await expect(missing.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await artwork.evaluate(/** 提交第一位玩家第二张牌的实际背景。
     * @param element - 负责绘制背景的节点。
     * @param source - 正确的牌面资源地址。 */ (element, source) => {
      element.style.backgroundImage = `url("${source}")`;
    }, correctSource);
  })()]);
});
