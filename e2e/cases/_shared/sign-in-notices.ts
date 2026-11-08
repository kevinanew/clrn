import { expect, test, type Page, type Locator } from '../../helpers/diagnostic-test';
import { unique } from './page';

const reliefNotice = /^(?:3000个免费的金币，请收下|3000 free coins, please accept them)$/;
const clubNotice = /^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/;
type Notices = { privacy: boolean; relief: boolean; club: boolean };
type AlertKind = 'relief' | 'club';
const alertPatterns = { relief: reliefNotice, club: clubNotice };

/**
 * 每页最多处理一次每种已知提示；未知和重复提示继续阻断业务操作。
 * @param page - 当前页面。
 */
export async function installSignInNoticeHandler(page: Page): Promise<void> {
  const state: Notices = { privacy: false, relief: false, club: false };
  const message = alertMessage(page);
  const privacy = privacyTitle(page);
  const knownNotice = message.filter({ hasText: reliefNotice })
    .or(message.filter({ hasText: clubNotice })).or(privacy).first();
  await page.addLocatorHandler(knownNotice, /** 处理最多三层已知叠加提示。 */ async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!await handleOverlay(page, state)) return;
    }
  }, { noWaitAfter: true });
}

/**
 * 保留隐私优先顺序；下层按钮被遮挡时让原业务继续处理上层弹窗。
 * @param page - 当前页面。
 * @param state - 本页已处理状态。
 */
async function handleOverlay(page: Page, state: Notices) {
  if (await handlePrivacyOverlay(page, state)) return true;
  return handleAlert(page, state, true);
}

/**
 * 用真实按钮处理已知提示，先试探目标，避免重复执行业务点击。
 * @param page - 当前页面。
 * @param testId - 目标测试标记。
 */
export async function clickAfterSignInNotices(page: Page, testId: string): Promise<void> {
  const state: Notices = { privacy: false, relief: false, club: false };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await targetReady(page, testId, state)) break;
  }
  await (await unique(page, testId)).click();
}

/**
 * 只在目标试探失败时处理提示，未知提示原样传播目标错误。
 * @param page - 当前页面。
 * @param testId - 目标测试标记。
 * @param state - 已处理提示。
 */
async function targetReady(page: Page, testId: string, state: Notices) {
  const target = await unique(page, testId);
  try {
    await target.click({ trial: true, timeout: 3_000 });
    return true;
  } catch (error) {
    await clearBlockingNotice(page, state, error);
    return false;
  }
}

/**
 * 隐私优先；没有可处理的已知提示时保留原始目标错误。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 * @param error - 目标不可操作的原始错误。
 */
async function clearBlockingNotice(page: Page, state: Notices, error: unknown) {
  if (await handlePrivacyBlocker(page, state)) return;
  if (await handleAlert(page, state, false)) return;
  throw error;
}

/**
 * 返回可见隐私标题。
 * @param page - 当前页面。
 */
function privacyTitle(page: Page) { return page.getByTestId('privacy-popup-title').filter({ visible: true }); }

/**
 * 返回可见业务提示。
 * @param page - 当前页面。
 */
function alertMessage(page: Page) { return page.getByTestId('alert-message-text').filter({ visible: true }); }

/**
 * 只有未处理过且存在的隐私提示可被接受。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 */
async function privacyPending(page: Page, state: Notices) { return !state.privacy && await privacyTitle(page).count(); }

/**
 * 保留隐私标题、数量和政策正文断言。
 * @param page - 当前页面。
 */
async function expectPrivacy(page: Page) {
  await expect(privacyTitle(page)).toHaveCount(1);
  await expect(privacyTitle(page)).toHaveText('用户隐私策略概要');
  await expect(await unique(page, 'privacy-popup-content')).toContainText('隐私政策');
}

/**
 * 自动处理器先确认按钮在最上层，再校验隐私内容。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 */
async function handlePrivacyOverlay(page: Page, state: Notices) {
  if (!await privacyPending(page, state)) return false;
  const agree = page.getByTestId('privacy-popup-agree').filter({ visible: true });
  if (!await onTop(agree)) return false;
  await expectPrivacy(page);
  await acceptPrivacy(page, state, agree);
  return true;
}

/**
 * 显式点击流程先检查隐私内容，再试探按钮，保留原有断言顺序。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 */
async function handlePrivacyBlocker(page: Page, state: Notices) {
  if (!await privacyPending(page, state)) return false;
  await expectPrivacy(page);
  const agree = await unique(page, 'privacy-popup-agree');
  if (!await onTop(agree)) return false;
  await acceptPrivacy(page, state, agree);
  return true;
}

/**
 * 接受隐私提示并等到它消失后记录状态。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 * @param agree - 已验证的同意按钮。
 */
async function acceptPrivacy(page: Page, state: Notices, agree: Locator) {
  await agree.click();
  await expect(privacyTitle(page)).not.toBeVisible();
  state.privacy = true;
}

/**
 * 保留一秒试探超时；失败只表示按钮仍被遮挡。
 * @param button - 待试探按钮。
 */
async function onTop(button: Locator) {
  return button.click({ trial: true, timeout: 1_000 })
    .then(/** 按钮可操作。 */ () => true).catch(/** 等待业务关闭上层弹窗。 */ () => false);
}

/**
 * 未知或重复提示没有分发项。
 * @param content - 提示的文本。
 * @param state - 已处理状态。
 */
function alertKind(content: string, state: Notices) {
  return (['relief', 'club'] as const).find(/** 匹配尚未处理的已知提示。
   * @param kind - 提示类型。 */ kind => !state[kind] && alertPatterns[kind].test(content));
}

/**
 * 空文本保持未知提示，不能推断成已知业务消息。
 * @param message - 唯一可见提示。
 */
async function alertContent(message: Locator) { return (await message.textContent())?.trim() || ''; }

/**
 * 只处理唯一且匹配白名单的提示。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 * @param probe - 自动处理器需要试探上层可操作性。
 */
async function handleAlert(page: Page, state: Notices, probe: boolean) {
  const message = alertMessage(page);
  if (!await message.count()) return false;
  await expect(message).toHaveCount(1);
  const kind = alertKind(await alertContent(message), state);
  if (!kind) return false;
  return dismissAlert(page, state, kind, probe);
}

/**
 * 救济金只能取消；俱乐部后台错误只能确认。
 * @param page - 当前页面。
 * @param kind - 已匹配类型。
 */
async function alertButton(page: Page, kind: AlertKind) {
  if (kind === 'relief') {
    const cancel = page.getByTestId('alert-custom-button').filter({ visible: true }).filter({ hasText: /^(?:取消|Cancel)$/ });
    await expect(cancel).toHaveCount(1);
    return cancel;
  }
  const confirm = await unique(page, 'alert-custom-button');
  await expect(confirm).toHaveText('好的');
  return confirm;
}

/**
 * 自动处理器不点击被遮挡的提示，显式处理流程保持原有真实点击。
 * @param button - 已验证的按钮。
 * @param probe - 是否先试探。
 */
async function clickAlert(button: Locator, probe: boolean) {
  if (probe && !await onTop(button)) return false;
  await button.click();
  return true;
}

/**
 * 只等待当前提示内容消失，复用的 alert 节点可继续显示下一条消息。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 * @param kind - 提示类型。
 * @param probe - 是否来自自动处理器。
 */
async function dismissAlert(page: Page, state: Notices, kind: AlertKind, probe: boolean) {
  if (!await clickAlert(await alertButton(page, kind), probe)) return false;
  await finishAlert(page, state, kind, probe);
  annotateAlert(kind);
  return true;
}

/**
 * 保留处理器与显式操作原来的状态记录时机。
 * @param page - 当前页面。
 * @param state - 已处理状态。
 * @param kind - 提示类型。
 * @param probe - 自动处理器在点击后立即记录。
 */
async function finishAlert(page: Page, state: Notices, kind: AlertKind, probe: boolean) {
  if (probe) state[kind] = true;
  await expect(alertMessage(page).filter({ hasText: alertPatterns[kind] })).not.toBeVisible();
  state[kind] = true;
}

/**
 * 只记录已确认的后台俱乐部错误。
 * @param kind - 已处理类型。
 */
function annotateAlert(kind: AlertKind) {
  if (kind === 'club') test.info().annotations.push({ type: 'staging-background-error', description: '登录后后台俱乐部请求出错，用户确认一次后继续。' });
}
