import type { Page } from '@playwright/test';
import { expect } from './proxy';
import { REPLAY_PLAYER_IDS } from './replayData';

/** 翻牌圈必须显示三张公共牌和本人两张手牌，精灵图加载完成后才能截图。 */
export async function checkFlopCardFaces(page: Page): Promise<void> {
  const communityFaces = page.locator('[data-testid="community_card"] [data-testid="sprite-image-content"]');
  // 本人未摊牌的手牌由桌面 PlayerCard 渲染，头像旁的手牌只用于公开牌。
  const handCards = page.getByTestId('player_card').filter({
    has: page.getByTestId('player_card_name_text').filter({ hasText: /^(as|ad)$/ }),
  });
  await expect(handCards.getByTestId('player_card_name_text')).toHaveText(['as', 'ad']);
  // 恢复牌局时 A 面直接显示已知手牌；实时发牌翻开后由 B 面显示。
  const handFronts = handCards.locator(
    '[data-testid="card-flip"][data-side="0"] > [data-testid="card-flip-side-a"], '
    + '[data-testid="card-flip"][data-side="1"] > [data-testid="card-flip-side-b"]',
  );
  await expect(handFronts).toHaveCount(2);
  for (const front of await handFronts.all()) await expect(front).toHaveCSS('opacity', '1');
  const holeFaces = handFronts.getByTestId('sprite-image-content');
  await expect(communityFaces).toHaveCount(3);
  await expect(holeFaces).toHaveCount(2);
  for (const faces of [communityFaces, holeFaces]) {
    for (const face of await faces.all()) {
      await expect(face).toBeVisible();
      await expect(face).toHaveCSS('opacity', '1');
    }
  }
}

/** 使用真实回放玩家检查手机端动作提示与昵称的纵向间距。 */
export async function checkMobilePlayerAction(page: Page): Promise<void> {
  const player = page.getByTestId(`texas-holdem-player-container-${REPLAY_PLAYER_IDS[0]}`);
  const nickname = player.getByTestId('adaptable-text-web').filter({ hasText: /^Player1$/ });
  const action = player.getByTestId('texas-holdem-player-action-call');
  await expect(nickname).toBeVisible();
  await expect(action).toBeVisible();
  const [nicknameBox, actionBox] = await Promise.all([nickname.boundingBox(), action.boundingBox()]);
  if (!nicknameBox || !actionBox) {
    throw new Error('手机端翻牌圈玩家昵称或动作提示缺少可见布局区域');
  }
  expect(actionBox.y, '动作提示应位于昵称下方').toBeGreaterThanOrEqual(nicknameBox.y + nicknameBox.height);
}
