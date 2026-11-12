/** 德州及短牌高级设置截图的业务和取景检查。 */
import { expect, type Page } from '@playwright/test';

/**
 * 确认 RTC 已下线，仍支持的消息设置、完整高级选项及建房按钮均可见。
 * @param page - 已完成导航和稳定化的建房页面。
 */
export async function assertAdvancedRoomReady(page: Page): Promise<void> {
  const screen = page.locator('[data-testid="base-create-room-screen"]:visible').last();
  await expect(page.getByTestId('allow-player-rtc-switch'), '已下线的实时音视频开关不能重新出现').toHaveCount(0);
  // 底部按钮沿用应用实际的 creat-room-button 拼写，外层组件的 testID 未传递到 DOM。
  for (const id of ['advanced-options-button', 'advanced-options-container-view',
    'allow-audience-text-message-switch', 'allow-audience-voice-message-switch',
    'allow-player-text-message-switch', 'allow-player-voice-message-switch',
    'operation-duration-title-text', 'creat-room-button']) {
    const control = screen.getByTestId(id);
    await expect(control, `${id} 必须存在且可见`).toBeVisible();
    await expect(control, `${id} 必须完整可见，不能保存裁切的高级设置`).toBeInViewport({ ratio: 1 });
  }
}
