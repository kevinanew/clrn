import { expect, test } from '@playwright/test';
import { checkFlopCardFaces, checkMobilePlayerAction } from '../cases/texas-holdem/renderingChecks';
import { REPLAY_PLAYER_IDS } from '../cases/texas-holdem/replayData';

const face = '<div data-testid="sprite-image-content" style="width:40px;height:60px;opacity:1"></div>';

/** 使用与真实 PlayerCard 一致的翻牌两面和牌名标记。 */
function handCard(name: string, content = face, opacity = 1): string {
  return `<div data-testid="player_card">
    <div data-testid="card-flip-side-a" style="opacity:0">牌背</div>
    <div data-testid="card-flip-side-b" style="opacity:${opacity}">${content}</div>
    <span data-testid="player_card_name_text">${name}</span>
  </div>`;
}

test('翻牌圈等待五张精灵牌面完成加载', async ({ page }) => {
  await page.setContent(`
    ${Array.from({ length: 3 }, () => `<div data-testid="community_card">${face}</div>`).join('')}
    ${handCard('as')}${handCard('ad')}${handCard('')}
  `);
  await page.getByTestId('player_card').nth(1).getByTestId('sprite-image-content').evaluate(node => {
    (node as HTMLElement).style.opacity = '0';
    setTimeout(() => { (node as HTMLElement).style.opacity = '1'; }, 100);
  });
  await checkFlopCardFaces(page);
});

test('翻牌圈不能用文本回退代替缺失的精灵牌面', async ({ page }) => {
  await page.setContent(`
    ${Array.from({ length: 3 }, () => `<div data-testid="community_card">${face}</div>`).join('')}
    ${handCard('as')}${handCard('ad', '<span>Ad</span>')}
  `);
  await expect(checkFlopCardFaces(page)).rejects.toThrow();
});

test('手牌正面未翻开时不能通过牌面检查', async ({ page }) => {
  await page.setContent(`
    ${Array.from({ length: 3 }, () => `<div data-testid="community_card">${face}</div>`).join('')}
    ${handCard('as')}${handCard('ad', face, 0)}
  `);
  await expect(checkFlopCardFaces(page)).rejects.toThrow();
});

for (const overlap of [false, true]) {
  test(`手机端动作提示${overlap ? '与昵称重叠时失败' : '位于昵称下方'}`, async ({ page }) => {
    await page.setContent(`
      <div data-testid="texas-holdem-player-container-${REPLAY_PLAYER_IDS[0]}">
        <div data-testid="adaptable-text-web" style="position:absolute;top:10px;height:20px">Player1</div>
        <div data-testid="texas-holdem-player-action-call" style="position:absolute;top:${overlap ? 20 : 30}px;height:20px">Call</div>
      </div>
    `);
    if (overlap) await expect(checkMobilePlayerAction(page)).rejects.toThrow('动作提示应位于昵称下方');
    else await checkMobilePlayerAction(page);
  });
}
