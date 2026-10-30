import { test, expect, type TexasProxy } from '../cases/texas-holdem/proxy';
import { REPLAY_PLAYER_IDS, restoreTable } from '../cases/texas-holdem/replayData';
import { withTable, type TableSession } from './tableSession';
import { advanceCardSpriteClock } from './cardSpriteClock';
import { waitForTexasCardSprites } from './cardSpriteReadiness';
import { sampleCardSprites } from './cardSpriteDiagnostics';

/**
 * 从新房间恢复相同牌局，保持真实订阅及固定业务状态检查。
 * @param session - 本轮独占的新页面与房间。
 * @param proxy - 绑定本轮房间的代理。
 */
async function prepareRound(session: TableSession, proxy: TexasProxy): Promise<void> {
  const { page, roomId, self } = session;
  await expect.poll(async () => {
    await advanceCardSpriteClock(page, 250);
    return proxy.replayTexas(roomId, restoreTable(self, 'preflop')).then(() => true, () => false);
  }, { timeout: 30_000, message: '独立图集取证必须完成真实房间订阅' }).toBe(true);
  await advanceCardSpriteClock(page, 3000);
  await expect(page.locator('[data-testid^="texas-holdem-player-container-"]:visible')).toHaveCount(5);
  await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible();
  for (const [street, count] of [['flop', 3], ['turn', 4], ['river', 5]] as const) {
    await sampleCardSprites(page, 'control-before-' + street);
    await proxy.replayTexas(roomId, { scene: 'texas-gameplay-start_street', parameters: { street } });
    await expect(page.locator('[data-testid="community_card"] [data-testid="sprite-image-content"]')).toHaveCount(count);
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    // 与原公共牌段同长的准备过程；不采集或比较固定相位基准。
    for (let elapsed = 0; elapsed < 1200; elapsed += 16) await advanceCardSpriteClock(page, 16);
  }
}

// 每项测试分别创建 context/page/真实房间。顺序交替由 repeatEachIndex 控制，失败没有重试。
for (const position of [0, 1]) {
  test(`independent card sprite clock ${position}`, async ({ browser, mitmproxy }, info) => {
    test.setTimeout(240_000);
    expect(process.env.CLRN_EXPECTED_APPLICATION_COMMIT, '必须指定同一完整应用提交').toMatch(/^[a-f0-9]{40}$/);
    expect(process.env.CLRN_RELEASE_WEB_ROOT, '必须使用校验过摘要的固定 Release').toBeTruthy();
    const clock = (position + info.repeatEachIndex) % 2 === 0 ? 'frozen' : 'normal';
    await info.attach('independent-clock', { body: clock, contentType: 'text/plain' });
    try {
      await withTable(browser, info, 'texas', mitmproxy, async session => {
        const { page, roomId } = session;
        await prepareRound(session, mitmproxy);
        const opponent = page.locator(`[data-testid^="texas-holdem-player-container-${REPLAY_PLAYER_IDS[0]}"]:visible`).last();
        const cards = opponent.getByTestId('texas-holdem-player-hole-cards');
        const scope = `[data-testid^="texas-holdem-player-container-${REPLAY_PLAYER_IDS[0]}"] `
          + '[data-testid="texas-holdem-player-hole-cards"]';
        await sampleCardSprites(page, 'before-all-in-replay');
        await mitmproxy.replayTexas(roomId, { scene: 'texas-gameplay-all_in-all_in_show_hole_card' });
        await expect(opponent.getByTestId('texas-holdem-player-action-all_in')).toBeAttached();
        await expect(cards.getByTestId('sprite-image-container')).toHaveCount(2);
        await expect(cards.getByTestId('poker-text-letter')).toHaveText(['k', 'k']);
        await expect(cards.getByTestId('poker-text-suit')).toHaveText(['♥', '♠']);
        await waitForTexasCardSprites(page, scope);
        for (let elapsed = 0; elapsed < 3200; elapsed += 16) await advanceCardSpriteClock(page, 16);
        await sampleCardSprites(page, 'before-showdown-replay');
        await mitmproxy.replayTexas(roomId, { scene: 'texas-gameplay-showdown' });
        await waitForTexasCardSprites(page, scope);
        await waitForTexasCardSprites(page, '[data-testid="texas-holdem-player-hole-cards"]');
        await sampleCardSprites(page, 'independent-showdown-ready');
        const lifecycle = await page.getByTestId('sprite-image-container').first().evaluate(node => {
          const state = window as typeof window & { __clrnCardSpriteLifecycle: (node: Element) => {
            status: string; commits: number; truncated: boolean; component: { supported: boolean } | null;
          } };
          return state.__clrnCardSpriteLifecycle(node);
        });
        expect(lifecycle.status, '不支持的 React 提交观察必须明确保留未通过').toBe('renderer-observed');
        expect(lifecycle.commits).toBeGreaterThan(0);
        expect(lifecycle.truncated).toBe(false);
        expect(lifecycle.component?.supported, '不得将未知组件结构解释为 visible/scale 状态').toBe(true);
        await info.attach('independent-showdown', {
          body: await page.screenshot({ animations: 'allow', clip: session.clip }), contentType: 'image/png',
        });
      }, false, clock, true);
    } finally { await mitmproxy.releaseTexas(); }
  });
}
