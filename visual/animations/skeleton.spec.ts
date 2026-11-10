import { selectScenario, scenarioStatus } from '../../e2e/helpers/scenario-proxy';
import { expect, test } from '../src/support/networkFixture';
import { openApplication, press } from './appSession';
import { captureTimeline, fixedArea, freeze } from './timeline';
import { readAuthStateEntries } from '../src/support/pageSetup';

test('club list placeholders pulse while details are pending', /** 验证俱乐部详情挂起期间列表占位的脉冲动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ context, page }, info) => {
  const userId = skeletonUser();
  await selectScenario(context, 'club-skeleton', { userId: userId as string });
  try {
    await openApplication(context, page, info);
    await expect.poll(/** 轮询代理请求计数，确认 skeleton 场景已经开始加载数据。 */ async () => (await scenarioStatus(context)).requests, { timeout: 60_000, message: '等待大厅首次加载俱乐部详情，再暂缓下一次响应' }).toBeGreaterThan(0);
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

/** 读取并校验骨架场景绑定的本轮真实登录账号。 */
function skeletonUser(): string {
  const userId = authUserId();
  expect(typeof userId === 'string' && userId.length > 0, '骨架夹具必须绑定本轮真实登录账号').toBe(true);
  return userId as string;
}

/** 读取原始登录资料，缺失时使用空对象。 */
function authUserId(): unknown {
  return JSON.parse(readAuthStateEntries()?.['save.user.origin.data.from.server.key'] || '{}').user_id;
}
