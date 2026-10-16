import { expect, test } from '@playwright/test';
import { openApplication, navigate, press } from './appSession';
import { captureTimeline, fixedArea, freeze } from './timeline';
import { mockSlotMessages } from './slotFixtures';

test('slot reels and all three reward animations', async ({ context, page }, info) => {
  test.setTimeout(600_000);
  const fixture = await mockSlotMessages(page);
  try {
    await openApplication(context, page, info);
    fixture.bindUser(await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key')!).user_id));
    await navigate(page, 'slot-banner');
    const panel = page.getByTestId('slot-machine-view');
    await expect(panel.getByTestId('energy-bar-text')).toHaveText('50 / 50');
    const clip = await fixedArea(page, panel, 0);
    await freeze(page);
    for (const [index, currency] of ['coin', 'currency_diamond', 'energy'].entries()) {
      fixture.reward(currency as 'coin' | 'currency_diamond' | 'energy');
      await press(page, 'spin-button');
      await expect.poll(async () => {
        await page.clock.runFor(16);
        return fixture.spins;
      }, { message: '老虎机旋转请求必须由本轮夹具处理' }).toBe(index + 1);
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
    await info.attach('slot-rpc-paths', { body: JSON.stringify(fixture.observed), contentType: 'application/json' });
  }
});
