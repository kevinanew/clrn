import { selectScenario, scenarioStatus } from '../../e2e/helpers/scenario-proxy';
import { expect, test } from '../src/support/networkFixture';
import { openApplication, press } from './appSession';
import { captureTimeline, fixedArea, freeze } from './timeline';
import { readAuthStateEntries } from '../src/support/pageSetup';

test('club list placeholders pulse while details are pending', async ({ context, page }, info) => {
  const userId: unknown = JSON.parse(readAuthStateEntries()?.['save.user.origin.data.from.server.key'] || '{}').user_id;
  expect(typeof userId === 'string' && userId.length > 0, '骨架夹具必须绑定本轮真实登录账号').toBe(true);
  await selectScenario(context, 'club-skeleton', { userId: userId as string });
  try {
    await openApplication(context, page, info);
    await expect.poll(async () => (await scenarioStatus(context)).requests, { timeout: 60_000, message: '等待大厅首次加载俱乐部详情，再暂缓下一次响应' }).toBeGreaterThan(0);
    await selectScenario(context, 'club-skeleton', { phase: 'hold' });
    await freeze(page);
    await press(page, 'club-tab');
    await page.clock.runFor(16);
    const placeholders = page.getByTestId('ClubItemPlaceholder_container');
    await expect(placeholders).toHaveCount(2);
    await captureTimeline(page, info, 'club-list-skeleton', placeholders,
      { clip: await fixedArea(page, placeholders.first()), times: [0, 160, 400, 800, 1200, 1600] });
    await selectScenario(context, 'club-skeleton', { phase: 'release' });
    await page.clock.resume();
    await expect(page.getByText('TestClub1', { exact: true })).toBeVisible();
  } finally { await selectScenario(context, 'club-skeleton', { phase: 'release' }); }
});
