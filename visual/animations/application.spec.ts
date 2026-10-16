import { test, expect } from '@playwright/test';
import { navigate, openApplication, visible, press, pressTarget } from './appSession';
import { exercisePopup } from './popups';
import { captureTimeline, freeze } from './timeline';
import { mockMatching } from './matchingFixtures';
import { mockInvitableRoom } from './applicationFixtures';

test('guest search confirmation enter and exit', async ({ context, page }, info) => {
  await openApplication(context, page, info, 'hall');
  await expect(page.getByTestId('match-game-bet-info').first()).toHaveText('1/2', { timeout: 60_000 });
  const viewport = page.viewportSize()!;
  await exercisePopup(page, info, {
    name: 'search-confirmation', target: page.getByTestId('pop-up-message-text'),
    clip: { x: Math.round(viewport.width / 2 - 171), y: Math.round(viewport.height / 2 - 120), width: 342, height: 240 },
    open: /** 点击真实入口。 */ () => press(page, 'hall-search-button'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, 'cancel-button'),
  });
});

test('club more menu enter and exit', async ({ context, page }, info) => {
  await openApplication(context, page, info);
  await navigate(page, 'club-tab');
  await exercisePopup(page, info, { name: 'club-more', target: page.getByTestId('club-more-popup'),
    open: /** 点击真实入口。 */ () => press(page, 'show-more-button'),
    close: /** 点击实际遮罩关闭，不依赖 Modal 重开后的键盘焦点。 */ () => pressTarget(visible(page, 'popup-backdrop')),
  });
});

test('private room invitation bottom sheet enter and exit', async ({ context, page }, info) => {
  await openApplication(context, page, info);
  await mockInvitableRoom(context);
  await navigate(page, 'private-room-tab');
  await expect(visible(page, 'copy-house-number-button')).toBeVisible();
  await exercisePopup(page, info, { name: 'invite-friends', target: page.getByTestId('invite-friend-popup-cancel-button'),
    clip: { x: 0, y: page.viewportSize()!.height - 300, width: page.viewportSize()!.width, height: 300 },
    open: /** 点击真实入口。 */ () => press(page, 'invite-friends-button'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, 'invite-friend-popup-cancel-button'),
  });
});

test('create room game picker enter and exit', async ({ context, page }, info) => {
  await openApplication(context, page, info);
  await navigate(page, 'private-room-tab');
  await expect(visible(page, 'create-game-button')).toBeVisible();
  await exercisePopup(page, info, { name: 'game-picker', target: page.getByTestId('select-game-category-text'),
    clip: { x: 0, y: page.viewportSize()!.height - 400, width: page.viewportSize()!.width, height: 400 },
    open: /** 点击真实入口。 */ () => press(page, 'create-game-button'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => pressTarget(page.getByRole('button', { name: /Bottom sheet backdrop/i })),
  });
});

test('club rooms empty state fades in', async ({ context, page }, info) => {
  await openApplication(context, page, info);
  await navigate(page, 'club-tab');
  const target = page.getByTestId('club-rooms-empty-title');
  await freeze(page);
  await press(page, 'club_tab_room');
  await page.clock.runFor(16);
  await expect(target).toBeAttached();
  await captureTimeline(page, info, 'club-empty', target, { startOffset: 16, requireMotion: true });
});

test('hall matching spinner modal enter and exit', async ({ context, page }, info) => {
  await mockMatching(context, page);
  await openApplication(context, page, info);
  await expect(page.getByTestId('match-game-bet-info').first()).toHaveText('1/2', { timeout: 60_000 });
  const target = page.getByTestId('game-matching-loading-view').locator('img.rotating-image');
  await exercisePopup(page, info, { name: 'hall-matching', target, exitAnimated: false,
    clip: { x: Math.round(page.viewportSize()!.width / 2 - 171), y: Math.round(page.viewportSize()!.height / 2 - 160), width: 342, height: 320 },
    open: /** 通过真实匹配入口显示旋转提示。 */ () => press(page, 'match-game-item-texas_holdem-tourists'),
    close: /** 退出本地夹具中的等待状态。 */ async () => {
      await press(page, 'quick-start-room-cancel');
      await page.clock.runFor(0);
    },
  });
});
