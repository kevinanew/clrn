/** 使用真实浏览器重现建房失败后的两段弹窗延迟、无提示及页面关闭，验证错误和截图取证。 */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readRoomCreationResponse } from '../src/support/roomCreationFailure';

// 本机测试只向响应读取器传入已接收的业务结果，不伪造浏览器网络响应。
const rejectedResponse = {
  ok: /** 返回已接收的 HTTP 成功状态。 */ () => true,
  status: /** 返回实际使用的业务错误 HTTP 状态码。 */ () => 200,
  json: /** 返回房间重复创建的响应正文。 */ async () => ({
    ok: false, error_type: 'room_already_exists', error_message: 'Room already exists',
  }),
};

/**
 * 重现应用收到业务拒绝后关闭加载层，并经过两段延迟展示错误的界面时序。
 * @param page - 本例独立浏览器页面。
 * @param showAlert - 是否展示应用错误弹窗。
 */
async function renderRoomForm(page: Page, showAlert = true): Promise<void> {
  await page.setContent(`
    <button onclick="submitRoom()">Start now</button>
    <script>
      function submitRoom() {
        if (${showAlert}) setTimeout(() => setTimeout(() => {
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.innerHTML = '<h2 data-testid="alert-title">Create game failed</h2>'
            + '<p data-testid="alert-message-text">Room already exists</p><button>OK</button>';
          document.body.appendChild(dialog);
        }, 500), 500);
      }
    </script>`);
}

for (const width of [375, 1440]) {
  test(`${width} 像素建房被拒绝后等待晚到的弹窗再保存截图`, /** 验证画面和动画视口均保留业务拒绝及前端提示。
   * @param fixtures - 当前浏览器页面。 */ async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await renderRoomForm(page);
    await page.getByRole('button', { name: 'Start now' }).click();
    await expect(readRoomCreationResponse(page, rejectedResponse)).rejects.toThrow('reason=business-rejected');
    await expect(page.getByTestId('alert-message-text')).toBeVisible();
    const diagnostic = JSON.parse(await readFile(test.info().outputPath('room-create-failure.json'), 'utf8'));
    expect(diagnostic).toMatchObject({ alert: 'visible', pageClosed: false,
      messages: ['Create game failed', 'Room already exists'] });
    const screenshot = await readFile(test.info().outputPath('room-create-failure.png'));
    expect(screenshot.subarray(1, 4).toString()).toBe('PNG');
    expect(test.info().attachments.map(/** 读取报告附件名称。
     * @param attachment - 当前附件。 */ attachment => attachment.name))
      .toContain('room-create-failure-screenshot');
  });
}

test('前端没有弹窗时有界等待并记录未观察到提示，仍保留接口拒绝', /** 验证没有 UI 提示不能变成成功。
 * @param fixtures - 当前浏览器页面。 */ async ({ page }) => {
  await renderRoomForm(page, false);
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(readRoomCreationResponse(page, rejectedResponse)).rejects.toThrow('reason=business-rejected');
  expect(JSON.parse(await readFile(test.info().outputPath('room-create-failure.json'), 'utf8')))
    .toMatchObject({ alert: 'not-observed', pageClosed: false, messages: [] });
});

test('页面关闭导致截图失败时仍抛出原始建房错误', /** 验证取证错误不覆盖真实业务失败。
 * @param fixtures - 当前浏览器页面。 */ async ({ page }) => {
  await renderRoomForm(page, false);
  await page.close();
  await expect(readRoomCreationResponse(page, rejectedResponse)).rejects.toThrow('reason=business-rejected');
});

test('建房成功时不等待提示也不生成失败附件', /** 验证正常建房不受取证逻辑影响。
 * @param fixtures - 当前浏览器页面。 */ async ({ page }) => {
  await renderRoomForm(page, false);
  await page.getByRole('button', { name: 'Start now' }).click();
  expect(await readRoomCreationResponse(page, { ...rejectedResponse,
    json: /** 返回正常创建结果。 */ async () => ({ ok: true, result: { room_id: 'created-room' } }),
  })).toMatchObject({ result: { room_id: 'created-room' } });
  expect(test.info().attachments).toEqual([]);
});
