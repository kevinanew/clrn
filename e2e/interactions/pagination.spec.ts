import { selectScenario, scenarioStatus } from '../helpers/scenario-proxy';
import { expect, openApp, test } from './fixtures';
import { drag, scroll, scrollToItem } from './gestures';

test('横向手势切换申请标签，触底按游标追加且末页停止请求', /**
 * 验证横滑与分页的可见结果及请求次数。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  context,
  isMobile,
}) => {
  await openApp(page);
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key')!).user_id as string);
  await selectScenario(context, 'pagination', { userId });
  await page.getByTestId('message-tab').click();
  await page.getByTestId('message-notification-item-buy-in').click();
  const unread = page.getByRole('tab', { name: '未处理', exact: true });
  const read = page.getByRole('tab', { name: '已处理', exact: true });
  await expect(unread).toHaveAttribute('aria-selected', 'true');
  const screen = await page.getByTestId('game-buy-in-application-list-screen').boundingBox();
  if (!screen) {
    throw new Error('申请页面没有布局区域');
  }
  const y = screen.y + screen.height / 2;
  // 分页组件接管手势后会重设起点；拖过八成页面宽度，避免仅靠末次速度跨过宽度约 57% 的门槛。
  await drag(
    page,
    { x: screen.x + screen.width * 0.9, y },
    { x: screen.x + screen.width * 0.1, y },
    isMobile,
  );
  await expect(read).toHaveAttribute('aria-selected', 'true');
  const list = page.locator('[data-testid="game-buy-in-application-list"]:visible');
  await expect(page.getByText('滚动玩家1', { exact: true })).toBeVisible();
  expect((await scenarioStatus(context)).cursors).toEqual([null]);
  await scrollToItem(page, list, page.getByText('滚动玩家15', { exact: true }), isMobile);
  await expect
    .poll(/** 读取已发出的分页游标。 */ async () => (await scenarioStatus(context)).cursors)
    .toEqual([null, 'interaction-page-2']);
  await expect(page.getByText('滚动玩家13', { exact: true })).toHaveCount(1);
  // 虚拟列表会保留首批单元；首页仍在，证明第二页是追加而不是覆盖。
  await expect(list.getByText('滚动玩家1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('滚动玩家15', { exact: true })).toHaveCount(1);
  await scroll(page, list, isMobile, -1);
  await scroll(page, list, isMobile);
  await scroll(page, list, isMobile);
  expect((await scenarioStatus(context)).cursors).toEqual([null, 'interaction-page-2']);
});
