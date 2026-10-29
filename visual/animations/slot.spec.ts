import { expect, test } from '../src/support/networkFixture';
import { openApplication, navigate, press } from './appSession';
import { captureTimeline, fixedArea, freeze } from './timeline';
import { selectScenario, scenarioStatus } from '../../e2e/helpers/scenario-proxy';

test('slot reels and all three reward animations', async ({ context, page }, info) => {
  test.setTimeout(600_000);
  await selectScenario(context, 'slot');
  try {
    await openApplication(context, page, info);
    await selectScenario(context, 'slot', { userId: await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key')!).user_id) });
    await navigate(page, 'slot-banner');
    const panel = page.getByTestId('slot-machine-view');
    await expect(panel.getByTestId('energy-bar-text')).toHaveText('50 / 50');
    const clip = await fixedArea(page, panel, 0);
    await freeze(page);
    for (const [index, currency] of ['coin', 'currency_diamond', 'energy'].entries()) {
      await selectScenario(context, 'slot', { phase: currency });
      await press(page, 'spin-button');
      await expect.poll(async () => {
        // RPC 准备阶段保持同一虚拟时刻，避免响应快慢改变滚轮动画的起点。
        await page.clock.runFor(0);
        return (await scenarioStatus(context)).spins;
      }, { message: '老虎机旋转请求必须由本轮夹具处理' }).toBe(index + 1);
      await page.clock.runFor(16);
      await captureTimeline(page, info, `slot-${currency}`, panel,
        { clip, times: [0, 160, 500, 1000, 1080, 1160, 1400, 2400] });
      const reward = currency === 'currency_diamond' ? 'diamond' : currency;
      await expect(panel.getByTestId(`prize_${reward}_text_animation_text`)).toHaveText(
        { coin: '100', diamond: '5', energy: '10' }[reward]!);
    }
    await panel.getByTestId('close-button').click();
    await page.clock.runFor(1600);
    await expect(panel).toBeHidden();
  } finally {
    await info.attach('slot-rpc-paths', { body: JSON.stringify((await scenarioStatus(context)).observed), contentType: 'application/json' });
  }
});
