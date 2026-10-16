import { expect, test } from '@playwright/test';
import { openApplication, press } from './appSession';
import { captureTimeline, fixedArea, freeze } from './timeline';

test('club list placeholders pulse while details are pending', async ({ context, page }, info) => {
  const clubs = [1, 2].map(index => ({ id: `00000000-0000-4000-8000-00000000010${index}`,
    club_no: 100 + index, name: `TestClub${index}`, owner_id: 'visual-owner', member_count: 5,
    created_at: '2026-01-01T00:00:00Z', admin_ids: [], game_type: 'texas_holdem' }));
  let hold = false;
  let loaded = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/v10/club' && url.searchParams.has('user_id'),
    route => route.fulfill({ json: { ok: true, result: { clubs: clubs.map(({ id }) => ({ id })) } } }));
  await page.route(url => url.pathname === '/v10/clubs', async route => {
    if (hold) await gate;
    loaded++;
    await route.fulfill({ json: { ok: true, result: clubs } });
  });
  try {
    await openApplication(context, page, info);
    await expect.poll(() => loaded, { timeout: 60_000, message: '等待大厅首次加载俱乐部详情，再暂缓下一次响应' }).toBeGreaterThan(0);
    hold = true;
    await freeze(page);
    await press(page, 'club-tab');
    await page.clock.runFor(16);
    const placeholders = page.getByTestId('ClubItemPlaceholder_container');
    await expect(placeholders).toHaveCount(2);
    await captureTimeline(page, info, 'club-list-skeleton', placeholders,
      { clip: await fixedArea(page, placeholders.first()), times: [0, 160, 400, 800, 1200, 1600] });
    release();
    await page.clock.resume();
    await expect(page.getByText('TestClub1', { exact: true })).toBeVisible();
  } finally { release(); }
});
