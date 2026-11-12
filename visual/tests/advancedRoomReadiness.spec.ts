/** 用真实浏览器验证 RTC 下线后高级设置的截图门禁。 */
import { expect, test, type Page } from '../src/support/diagnosticTest';
import { assertAdvancedRoomReady } from '../cases/private-room/advancedReadiness';

/**
 * 创建带有固定导航、滚动区域和底部建房按钮的最小页面。
 * @param page - 隔离的浏览器页面。
 */
async function renderOptions(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`
    <style>body { margin:0 } button { display:block;height:40px }</style>
    <div style="height:64px">导航栏</div>
    <div data-testid="base-create-room-screen">
      <div id="scroll" style="height:660px;overflow:auto">
        <button data-testid="advanced-options-button">高级设置</button>
        <div data-testid="advanced-options-container-view">
          <div style="height:120px">座位数</div>
          <button data-testid="allow-audience-text-message-switch">观众文本消息</button>
          <button data-testid="allow-audience-voice-message-switch">观众语音消息</button>
          <button data-testid="allow-player-text-message-switch">玩家文本消息</button>
          <button data-testid="allow-player-voice-message-switch">玩家语音消息</button>
          <div data-testid="operation-duration-title-text">回合时长</div>
          <div style="height:100px">回合时长滑杆</div>
        </div>
      </div>
      <button data-testid="creat-room-button">开始</button>
    </div>
  `);
}

test('无 RTC 的高级设置保留文本和语音消息及完整取景', /** 验证正常布局通过。
 * @param fixtures - 隔离浏览器页面。 */ async ({ page }) => {
  await renderOptions(page);
  await assertAdvancedRoomReady(page);
});

test('视频开关重新出现时不能更新基准', /** 验证删除功能的预期独立于像素容差。
 * @param fixtures - 隔离浏览器页面。 */ async ({ page }) => {
  await renderOptions(page);
  await page.getByTestId('advanced-options-container-view').evaluate(/** 注入旧视频开关。
   * @param element - 高级设置容器。 */ element => {
    element.insertAdjacentHTML('beforeend', '<button data-testid="allow-player-rtc-switch">视频</button>');
  });
  await expect(assertAdvancedRoomReady(page)).rejects.toThrow('已下线的实时音视频开关不能重新出现');
});

test('隐藏页面的语音开关不能代替当前页面缺失的控件', /** 验证消息功能不能随 RTC 一起删除。
 * @param fixtures - 隔离浏览器页面。 */ async ({ page }) => {
  await renderOptions(page);
  await page.getByTestId('allow-player-voice-message-switch').evaluate(/** 将消息开关移至非活动页面。
   * @param element - 玩家语音消息开关。 */ element => {
    const hidden = document.createElement('div');
    hidden.hidden = true;
    document.body.append(hidden);
    hidden.append(element);
  });
  await expect(assertAdvancedRoomReady(page)).rejects.toThrow('allow-player-voice-message-switch 必须存在且可见');
});

for (const [name, height] of [['标题被滚动裁切', '660px'], ['滑杆被父容器裁切', '320px']] as const) {
  test(name, /** 验证存在但被裁切的内容仍使基准采集失败。
   * @param fixtures - 隔离浏览器页面。 */ async ({ page }) => {
    await renderOptions(page);
    await page.locator('#scroll').evaluate(/** 重现滚动位置或容器高度错误。
     * @param element - 建房滚动容器。
     * @param value - 本次容器高度。 */ (element, value) => {
      element.style.height = value;
      if (value === '660px') {
        element.insertAdjacentHTML('beforeend', '<div style="height:600px"></div>');
        element.scrollTop = 20;
      }
    }, height);
    await expect(assertAdvancedRoomReady(page)).rejects.toThrow('不能保存裁切的高级设置');
  });
}
