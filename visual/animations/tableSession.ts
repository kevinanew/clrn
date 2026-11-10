import { bindScenarioProxy } from '../../e2e/helpers/scenario-proxy';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
/** 创建真实牌桌并在清理前保留操作、网络和连接诊断。 */
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createPrivateGameRoom, deletePrivateGameRoom, type RoomSession } from '../cases/_shared/room';
import { navigate, openApplication, visible } from './appSession';
import { enterTexasRoom } from '../cases/texas-holdem/room';
import { freeze, type CaptureArea } from './timeline';
import { paceNetworkClock } from './networkClock';
import { installConnectionDiagnostics, recordDiagnostic } from '../src/support/connectionDiagnostics';
import { diagnosticNode, diagnosticText } from '../../e2e/helpers/diagnostic-privacy';
import { installCardSpriteDiagnostics, observeCardSpriteClockControl, saveCardSpriteDiagnostics } from './cardSpriteDiagnostics';
import { useNormalCardSpriteClock, type CardSpriteClock } from './cardSpriteClock';
import { completedRoomPreflight, type ProxySnapshot } from './roomPreflight';
import { requestFailure } from '../src/support/requestError';

export type TableSession = { page: Page; roomId: string; self: string; clip: CaptureArea };

/**
 * 仅重试表单读取或确认未发出写入的预检超时，已登记的房间禁止重复创建。
 * @param page - 建房页面。
 * @param game - 游戏类型。
 * @param registerRoom - 立即登记成功响应。
 * @param registeredRoom - 读取已登记房间。
 * @param snapshot - 获取完整代理记录以核对写入边界。
 */
async function createRoomWithRetry(page: Page, game: 'texas' | 'zhajinhua',
  registerRoom: (created: RoomSession) => void, registeredRoom: () => RoomSession | undefined,
  snapshot?: () => Promise<ProxySnapshot>): Promise<RoomSession> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before: ProxySnapshot | undefined;
    try {
      return await createPrivateGameRoom(page, registerRoom, game === 'texas' ? 'texas_react_native' : 'zhajinhua', false,
        /** 创建房间前保存可选快照，供重试预检判断真实行为。 */ async () => { before = await snapshot?.().catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined); });
    } catch (error) {
      const after = await snapshot?.().catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
      await recoverRoomForm(page, error, attempt, registeredRoom(),
        Boolean(before && after && completedRoomPreflight(before, after)));
    }
  }
  throw new Error('建房未返回本轮房间');
}

/**
 * 已知的表单读取超时允许返回入口，其他错误保留原始失败。
 * @param page - 建房页面。
 * @param error - 原始建房错误。
 * @param attempt - 当前尝试序号。
 * @param room - 已创建房间。
 * @param preflightOnly - 完整代理记录证明只有成功预检，没有建房写入。
 */
async function recoverRoomForm(page: Page, error: unknown, attempt: number, room?: RoomSession, preflightOnly = false) {
  const alert = visible(page, 'common-alert-container').filter({ hasText: 'timeout of 10000ms exceeded' });
  if (attempt > 0 || room || !(error instanceof Error)
    || !(error.message.includes('base-create-room-screen')
      || preflightOnly && error.message === requestFailure('room-create', 'timeout').message)
    || !await alert.isVisible()) throw error;
  recordDiagnostic(page, preflightOnly ? '建房预检超时且未发送写入，返回后重试' : '建房表单读取超时，返回后重试', { attempt: attempt + 1 });
  await alert.locator('[data-testid^="common-alert-button-"]').click();
  await visible(page, 'navigation-bar-back-image').last().click();
  await expect(visible(page, 'create-game-button').last()).toBeVisible({ timeout: 90_000 });
}

/**
 * 等待牌桌连接，保留重试上限及应用错误诊断。
 * @param page - 牌桌页面。
 * @param game - 游戏类型。
 * @param prefix - 牌桌控件前缀。
 */
export async function waitForTableConnection(page: Page, game: string, prefix: string) {
  const connection = { state: 'loading' };
  let retries = 0;
  let retryAfter = 0;
  // 连接超时也会使用自定义 Alert，其按钮没有 common-alert 的业务 ID。
  const retry = visible(page, 'common-alert-button-retry').or(
    page.locator('[data-testid="alert-custom-button"]:visible').filter({ hasText: /^Retry$/ }),
  ).last();
  // 德州选线失败后会避让节点 120 秒，需留出避让结束后重新探测及订阅的时间。
  const timeout = game === 'texas' ? 180_000 : 90_000;
  await expect.poll(/** 轮询牌桌连接状态，有限重试后保留明确的连接失败状态。 */ async () => {
    if (await retry.isVisible()) {
      if (retries >= 3) connection.state = 'alert';
      else {
        // 沿用 af7848d：弹窗出现后等待十秒健康缓存过期，避免耗尽重试却未重新探测。
        retryAfter ||= Date.now() + (game === 'texas' ? 10_000 : 0);
        if (Date.now() < retryAfter) return connection.state;
        retryAfter = 0;
        retries += 1;
        recordDiagnostic(page, '重试牌桌连接', { attempt: retries });
        await retry.click();
      }
    } else if (await visible(page, `${prefix}-start-room-timer-button`).isVisible()) connection.state = 'ready';
    return connection.state;
  }, { timeout, message: `${game} 牌桌应完成连接或显示应用错误弹窗` }).not.toBe('loading');
  if (connection.state === 'alert') {
    const message = (await page.locator('[data-testid="common-alert-container"]:visible')
      .locator('[data-testid="common-alert-title"], [data-testid="common-alert-message"], [data-testid="common-alert-sub-message"]')
      .allTextContents()).join('；') || '应用显示重试弹窗';
    throw new Error(`${game} 牌桌未就绪，应用提示：${diagnosticText(message)}；详见 connection-summary`);
  }
}

/**
 * 使用真实登录和创建入口建立隔离回放房间，无论断言结果如何都精确清理本轮房间。
 * @param browser - Playwright 浏览器。
 * @param info - 当前用例报告。
 * @param game - 游戏类型。
 * @param proxy - 专用游戏代理地址。
 * @param task - 在真实牌桌执行的动画流程。
 * @param hall - 是否使用大厅显示夹具和本房间观察者连接。
 * @param clock - 独立图集取证时可选择原生时间，默认仍为原动画冻结策略。
 * @param lifecycle - 是否安装独立 React 提交观察；callbacks 同时取证原构建的实际加载回调。
 */
export async function withTable(browser: Browser, info: TestInfo, game: 'texas' | 'zhajinhua',
  proxy: { server: string; network: Mitmproxy; diagnostics?: () => Promise<{ events: unknown[]; dropped: number }> }, task: (session: TableSession) => Promise<void>, hall = false,
  clock: CardSpriteClock = 'frozen', lifecycle: boolean | 'callbacks' = false): Promise<void> {
  const viewport = info.project.use.viewport!;
  const context = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1,
    proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
    reducedMotion: 'no-preference' });
  bindScenarioProxy(context, proxy.network);
  const page = await context.newPage();
  if (clock === 'normal') useNormalCardSpriteClock(page);
  let room: RoomSession | undefined;
  const diagnostics = await installConnectionDiagnostics(context, page, info, proxy);
  try {
    if (game === 'texas') await installCardSpriteDiagnostics(page, lifecycle, info);
    recordDiagnostic(page, '初始化大厅');
    console.log(`TABLE > ${game}/${info.project.name} 初始化大厅`);
    await openApplication(context, page, info, `signed_in_${game}_pre_game`);
    await navigate(page, 'private-room-tab');
    // 私房页需等待真实资料及房间请求结束，不能沿用动画帧断言的 15 秒超时。
    await expect(visible(page, 'create-game-button')).toBeVisible({ timeout: 90_000 });
    recordDiagnostic(page, '创建本轮房间');
    console.log('TABLE > 从真实入口创建本轮房间');
    /**
     * 立即登记真实创建响应，保证后续失败仍能精确清理。
     * @param created - 本次创建成功的房间。
     */
    const registerRoom = (created: RoomSession) => {
      room = created;
      recordDiagnostic(page, '建房成功', { roomId: created.roomId, node: diagnosticNode(created.apiOrigin) });
      writeFileSync(info.outputPath('created-room.json'), JSON.stringify({ roomId: created.roomId, apiNode: diagnosticNode(created.apiOrigin) }));
    };
    room = await createRoomWithRetry(page, game, registerRoom, /** 向建房重试器返回本次已创建的房间资料。 */ () => room,
      /** 提供代理诊断快照，缺失时标记取证不完整。 */ async () => await proxy.diagnostics?.() ?? { events: [], dropped: 1 });
    recordDiagnostic(page, '等待牌桌连接及订阅就绪');
    const prefix = game === 'texas' ? 'texas-holdem' : 'zhajinhua';
    if (hall) await enterTexasRoom(page, room);
    else {
      await waitForTableConnection(page, game, prefix);
    }
    await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
    if (clock === 'frozen') {
      paceNetworkClock(page);
      await freeze(page);
    }
    console.log('TABLE > 牌桌已就绪，开始动画采样');
    await sampleTable(page, info, room, viewport, task);
    await diagnostics.save();
    await saveCardSpriteDiagnostics(page, info);
  } catch (error) {
    await diagnostics.save(error).catch(/** 记录牌桌诊断保存失败，并保留原始用例异常。
 * @param failure - 当前操作使用的 failure。 */ failure => console.log(`诊断保存失败：${diagnosticText(failure)}`));
    const overlays = await page.evaluate(/** 在页面中采集残留遮罩的位置与关联测试标记。 */ () => Array.from(document.querySelectorAll('[data-testid="screen-mask-touch-to-close"]')).map(/** 整理当前遮罩边界及其父容器中的可识别内容。
 * @param mask - 当前操作使用的 mask。 */ mask => ({
      rect: mask.getBoundingClientRect().toJSON(),
      contents: Array.from(mask.parentElement?.querySelectorAll('[data-testid]') || []).map(/** 将当前条目映射为`node.getAttribute('data-testid')`。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getAttribute('data-testid')),
    }))).catch(/** 读取失败时提供空列表，避免诊断采集再次抛错。 */ () => []);
    writeFileSync(info.outputPath('overlays.json'), JSON.stringify(overlays, null, 2));
    await page.screenshot({ path: info.outputPath('failure.png'), timeout: 5000 }).catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
    // 先保留冻结时钟下的失败，再做诊断性时钟对照；任何恢复都不能改变原始失败。
    await saveCardSpriteDiagnostics(page, info, 'frozen').catch(/** 记录冻结牌面诊断保存失败，保留原始失败结果。
 * @param failure - 当前操作使用的 failure。 */ failure => console.log(`牌面诊断保存失败：${diagnosticText(failure)}`));
    await observeCardSpriteClockControl(page).catch(/** 记录独立牌面时钟对照失败，避免覆盖原异常。
 * @param failure - 当前操作使用的 failure。 */ failure => console.log(`牌面时钟对照失败：${diagnosticText(failure)}`));
    await saveCardSpriteDiagnostics(page, info).catch(/** 记录牌面对照附件保存失败，保留原用例结果。
 * @param failure - 当前操作使用的 failure。 */ failure => console.log(`牌面对照保存失败：${diagnosticText(failure)}`));
    sanitizeTableError(error);
    throw error;
  } finally {
    try { await deleteRegisteredRoom(room); }
    finally { await context.close(); }
  }
}

/**
 * 使用原有视口和登录用户采样牌桌。
 * @param page - 牌桌页面。
 * @param info - 用例报告。
 * @param room - 本轮房间。
 * @param viewport - 当前视口。
 * @param task - 动画流程。
 */
async function sampleTable(page: Page, info: TestInfo, room: RoomSession,
  viewport: { width: number; height: number }, task: (session: TableSession) => Promise<void>) {
  const self = await page.evaluate(/** 在页面中读取`JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string`，供测试判断当前界面状态。 */ () => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
  const width = info.project.name === 'mobile' ? 375 : 450;
  recordDiagnostic(page, '牌桌就绪，开始动画采样');
  await task({ page, roomId: room.roomId, self,
    clip: { x: Math.floor((viewport.width - width) / 2), y: 0, width, height: viewport.height } });
}

/**
 * 保留原始错误对象并清理诊断中的敏感字段。
 * @param error - 采样失败。
 */
function sanitizeTableError(error: unknown) {
  if (error instanceof Error) { error.message = diagnosticText(error.message); error.stack = diagnosticText(error.stack); }
}

/**
 * 只清理本轮已登记的房间。
 * @param room - 建房响应登记的房间。
 */
async function deleteRegisteredRoom(room?: RoomSession) {
  if (room) await deletePrivateGameRoom(room);
}
