/** 建房响应失败时等待应用错误提示并保存截图，不覆盖原始接口错误。 */
import { test, type Page, type Response } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { diagnosticText } from '../../../e2e/helpers/diagnostic-privacy';
import { readRequestJson } from './requestJson';

const alertTextSelector = '[data-testid="alert-title"], [data-testid="alert-message-text"], '
  + '[data-testid="common-alert-title"], [data-testid="common-alert-message"], '
  + '[data-testid="common-alert-sub-message"]';
const visibleAlertSelector = '[data-testid="alert-title"]:visible, [data-testid="common-alert-container"]:visible';

/**
 * 读取建房结果；失败时等待界面提示取证，然后继续抛出同一个接口错误。
 * @param page - 通过真实按钮提交建房的页面。
 * @param response - 已收到的建房响应，不重新发送请求。
 */
export async function readRoomCreationResponse(page: Page, response: Pick<Response, 'ok' | 'status' | 'json'>) {
  try {
    return await readRequestJson(response, 'room-create');
  } catch (error) {
    await captureRoomCreationFailure(page).catch(/** 取证失败也必须保留原始接口错误。 */ () => undefined);
    throw error;
  }
}

/**
 * 等待应用关闭加载层及延迟弹窗，保存可见文案和完整页面截图，不点击或隐藏提示。
 * @param page - 发生建房失败的页面。
 */
async function captureRoomCreationFailure(page: Page): Promise<void> {
  const info = test.info();
  // 应用关闭加载层及弹窗队列各延迟 500ms；等待真实可见状态，不以固定睡眠代替。
  const visible = await page.locator(visibleAlertSelector).first()
    .waitFor({ state: 'visible', timeout: 5000 }).then(/** 记录已出现的错误提示。 */ () => true,
      /** 等待超时或页面关闭均不等同于应用没有错误。 */ () => false);
  const messages = await page.locator(alertTextSelector).filter({ visible: true }).allTextContents()
    .catch(/** 页面已关闭时没有可读取的提示。 */ () => [] as string[]);
  const diagnostic = { alert: visible ? 'visible' : 'not-observed', timeoutMs: 5000,
    pageClosed: page.isClosed(), messages: messages.map(diagnosticText) };
  const diagnosticPath = info.outputPath('room-create-failure.json');
  await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2));
  console.warn(`room-create-ui ${JSON.stringify(diagnostic)}`);
  await info.attach('room-create-failure', { path: diagnosticPath, contentType: 'application/json' });
  const screenshotPath = info.outputPath('room-create-failure.png');
  await page.screenshot({ path: screenshotPath, timeout: 3000 });
  await info.attach('room-create-failure-screenshot', { path: screenshotPath, contentType: 'image/png' });
}
