import { expect, openApp, test } from './fixtures';
import { drag, scroll, scrollToItem } from './gestures';

/**
 * 生成独立的已处理申请，只替换分页接口数据，不替换列表及其滚动实现。
 * @param start - 本批申请昵称与标识的起始序号。
 * @param count - 要生成的申请数量。
 */
function applications(start: number, count: number) {
  return Array.from(
    { length: count },
    /**
     * 生成唯一申请标识和可见昵称。
     * @param _ - Array.from 传入的空元素，不参与数据生成。
     * @param index - 当前申请在本批数据中的索引。
     */ (_, index) => ({
      application_id: `interaction-${start + index}`,
      status: 'approve',
      amount: 100,
      user_id: 'interaction-player',
      created_at: '2026-09-01T00:00:00Z',
      auditor_id: 'interaction-auditor',
      nickname: `滚动玩家${start + index}`,
      building_name: '交互测试',
      room_name: '分页牌局',
    }),
  );
}

test('横向手势切换申请标签，触底按游标追加且末页停止请求', /**
 * 验证横滑与分页的可见结果及请求次数。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  const cursors: (string | null)[] = [];
  await page.route(
    '**/applications/pending',
    /**
     * 返回未处理空列表。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ (route) =>
      route.fulfill({ json: { ok: true, result: { applications: [], next_page: null } } }),
  );
  await page.route(
    '**/applications/processed**',
    /**
     * 按真实游标返回两页数据。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('next_page');
      cursors.push(cursor);
      expect([null, 'interaction-page-2']).toContain(cursor);
      await route.fulfill({
        json: {
          ok: true,
          result: {
            applications: cursor ? applications(13, 3) : applications(1, 12),
            next_page: cursor ? null : 'interaction-page-2',
          },
        },
      });
    },
  );
  await openApp(page);
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
  await drag(
    page,
    { x: screen.x + screen.width * 0.8, y },
    { x: screen.x + screen.width * 0.2, y },
    isMobile,
  );
  await expect(read).toHaveAttribute('aria-selected', 'true');
  const list = page.locator('[data-testid="game-buy-in-application-list"]:visible');
  await expect(page.getByText('滚动玩家1', { exact: true })).toBeVisible();
  expect(cursors).toEqual([null]);
  await scrollToItem(page, list, page.getByText('滚动玩家15', { exact: true }), isMobile);
  await expect
    .poll(/** 读取已发出的分页游标。 */ () => cursors)
    .toEqual([null, 'interaction-page-2']);
  await expect(page.getByText('滚动玩家13', { exact: true })).toHaveCount(1);
  // 虚拟列表会保留首批单元；首页仍在，证明第二页是追加而不是覆盖。
  await expect(list.getByText('滚动玩家1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('滚动玩家15', { exact: true })).toHaveCount(1);
  await scroll(page, list, isMobile, -1);
  await scroll(page, list, isMobile);
  await scroll(page, list, isMobile);
  expect(cursors).toEqual([null, 'interaction-page-2']);
});
