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
      return await createPrivateGameRoom(page, registerRoom, roomGameType(game), false,
        /** 创建房间前保存可选快照，供重试预检判断真实行为。 */ async () => { before = await optionalProxySnapshot(snapshot); });
    } catch (error) {
      const after = await optionalProxySnapshot(snapshot);
      await recoverRoomForm(page, error, attempt, registeredRoom(),
        preflightCompleted(before, after));
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
async function recoverRoomForm(page: Page, error: unknown, attempt: number, room: RoomSession | undefined, preflightOnly: boolean) {
  const alert = visible(page, 'common-alert-container').filter({ hasText: 'timeout of 10000ms exceeded' });
  assertRoomRecovery(error, attempt, room);
  if (!recoverableRoomError(error, preflightOnly)) throw error;
  if (!await alert.isVisible()) throw error;
  recordDiagnostic(page, roomRecoveryMessage(preflightOnly), { attempt: attempt + 1 });
  await alert.locator('[data-testid^="common-alert-button-"]').click();
  await visible(page, 'navigation-bar-back-image').last().click();
  await expect(visible(page, 'create-game-button').last()).toBeVisible({ timeout: 90_000 });
}

/**
 * 等待牌桌连接，保留重试上限及应用错误诊断。
 * @param page - 牌桌页面。
 * @param game - 游戏类型。
 * @param prefix - 牌桌控件前缀。
 * @param readyId - 当前房间类型实际提供的就绪控件。
 */
export async function waitForTableConnection(page: Page, game: string, prefix: string, readyId = `${prefix}-start-room-timer-button`) {
  const connection = { state: 'loading' };
  // 德州选线失败后会避让节点 120 秒，需留出避让结束后重新探测及订阅的时间。
  const timing = game === 'texas' ? { cacheWaitMs: 10_000, timeout: 180_000 } : { cacheWaitMs: 0, timeout: 90_000 };
  const retryState = { retries: 0, retryAfter: 0, cacheWaitMs: timing.cacheWaitMs };
  // 连接超时也会使用自定义 Alert，其按钮没有 common-alert 的业务 ID。
  const retry = visible(page, 'common-alert-button-retry').or(
    page.locator('[data-testid="alert-custom-button"]:visible').filter({ hasText: /^(Retry|重试|重試)$/ }),
  ).last();
  await expect.poll(/** 轮询牌桌连接状态，有限重试后保留明确的连接失败状态。 */ async () => {
    if (await retry.isVisible()) await retryTableConnection(page, retry, retryState, connection);
    else if (await visible(page, readyId).isVisible()) connection.state = 'ready';
    return connection.state;
  }, { timeout: timing.timeout, message: `${game} 牌桌应完成连接或显示应用错误弹窗` }).not.toBe('loading');
  await assertTableConnected(page, game, connection.state);
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
  proxy: { server: string; network: Mitmproxy; diagnostics?: () => Promise<{ events: unknown[]; dropped: number }> }, task: (session: TableSession) => Promise<void>, hall?: boolean,
  clock?: CardSpriteClock, lifecycle?: boolean | 'callbacks'): Promise<void> {
  const options = tableOptions(hall, clock, lifecycle);
  const viewport = info.project.use.viewport!;
  const context = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1,
    proxy: { server: proxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
    reducedMotion: 'no-preference' });
  bindScenarioProxy(context, proxy.network);
  const page = await context.newPage();
  prepareTableClock(page, options.clock);
  const registration: { room?: RoomSession } = {};
  const diagnostics = await installConnectionDiagnostics(context, page, info, proxy);
  try {
    await prepareAndSampleTable({ page, info, game, proxy, task, viewport, registration, ...options });
    await diagnostics.save();
    await saveCardSpriteDiagnostics(page, info);
  } catch (error) {
    await saveTableFailure(page, info, diagnostics, error);
    sanitizeTableError(error);
    throw error;
  } finally {
    try { await deleteRegisteredRoom(registration.room); }
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
  const self = await page.evaluate(/** 读取牌桌会话的登录用户标识，供测试房间与代理关联。 */ () => JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
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

/**
 * 诊断快照缺失或失败时保留不完整状态，不据此允许重试。
 * @param snapshot - 可选的代理快照读取器。
 * @returns 快照或缺失状态。
 */
async function optionalProxySnapshot(snapshot?: () => Promise<ProxySnapshot>): Promise<ProxySnapshot | undefined> {
  return snapshot?.().catch(/** 诊断失败不能覆盖建房错误。 */ () => undefined);
}

/**
 * 两次完整记录都存在才核对真实预检边界。
 * @param before - 建房前记录。
 * @param after - 建房失败后的记录。
 * @returns 是否只完成预检且未写入。
 */
function preflightCompleted(before?: ProxySnapshot, after?: ProxySnapshot): boolean {
  if (!before || !after) return false;
  return completedRoomPreflight(before, after);
}

/**
 * 保留真实建房接口的游戏名称映射。
 * @param game - 场景游戏。
 * @returns 接口游戏类型。
 */
function roomGameType(game: 'texas' | 'zhajinhua') { return game === 'texas' ? 'texas_react_native' as const : 'zhajinhua' as const; }

/**
 * 一次重试上限与已登记房间优先于所有恢复判断。
 * @param error - 原始失败。
 * @param attempt - 已执行的尝试。
 * @param room - 已登记的房间。
 */
function assertRoomRecovery(error: unknown, attempt: number, room?: RoomSession): asserts error is Error {
  if (attempt > 0 || room) throw error;
  assertErrorObject(error);
}

/**
 * 非 Error 失败也必须按原对象传播。
 * @param error - 原始失败。
 */
function assertErrorObject(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) throw error;
}

/**
 * 仅表单读取错误或有完整预检证明的创建超时可以重试。
 * @param error - 建房失败。
 * @param preflightOnly - 是否证明未发送写入。
 * @returns 是否允许恢复表单。
 */
function recoverableRoomError(error: Error, preflightOnly: boolean): boolean {
  if (error.message.includes('base-create-room-screen')) return true;
  return preflightOnly && error.message === requestFailure('room-create', 'timeout').message;
}

/**
 * 保留表单与预检恢复各自的诊断。
 * @param preflightOnly - 是否由完整预检证明允许恢复。
 * @returns 固定诊断文本。
 */
function roomRecoveryMessage(preflightOnly: boolean): string {
  return preflightOnly ? '建房预检超时且未发送写入，返回后重试' : '建房表单读取超时，返回后重试';
}

/**
 * 德州健康结果缓存十秒；过期后才点击前三次重试，第四次保留 alert 状态。
 * @param page - 当前牌桌。
 * @param retry - 真实重试按钮。
 * @param state - 当前重试次数。
 * @param connection - 轮询结果。
 */
async function retryTableConnection(page: Page, retry: import('@playwright/test').Locator,
  state: { retries: number; retryAfter: number; cacheWaitMs: number }, connection: { state: string }): Promise<void> {
  if (state.retries >= 3) connection.state = 'alert';
  else {
    if (!tableRetryDue(state)) return;
    state.retries += 1;
    state.retryAfter = 0;
    recordDiagnostic(page, '重试牌桌连接', { attempt: state.retries });
    await retry.click();
  }
}

/**
 * 从弹窗出现后计时，确保最后一个探测结果也已超过 Release 的缓存有效期。
 * @param state - 当前连接重试的缓存等待时间。
 */
function tableRetryDue(state: { retryAfter: number; cacheWaitMs: number }): boolean {
  state.retryAfter ||= Date.now() + state.cacheWaitMs;
  return Date.now() >= state.retryAfter;
}

/**
 * 应用显示最终重试弹窗时传播脱敏后的原始提示。
 * @param page - 当前牌桌。
 * @param game - 游戏名称。
 * @param state - 连接轮询结果。
 */
async function assertTableConnected(page: Page, game: string, state: string): Promise<void> {
  if (state === 'alert') {
    const message = (await page.locator('[data-testid="common-alert-container"]:visible')
      .locator('[data-testid="common-alert-title"], [data-testid="common-alert-message"], [data-testid="common-alert-sub-message"]')
      .allTextContents()).join('；') || '应用显示重试弹窗';
    throw new Error(`${game} 牌桌未就绪，应用提示：${diagnosticText(message)}；详见 connection-summary`);
  }
}

type TableProxy = Parameters<typeof withTable>[3];
type TableOptions = { hall: boolean; clock: CardSpriteClock; lifecycle: boolean | 'callbacks' };
type TableRuntime = TableOptions & {
  page: Page; info: TestInfo; game: 'texas' | 'zhajinhua'; proxy: TableProxy;
  task: (session: TableSession) => Promise<void>; viewport: { width: number; height: number };
  registration: { room?: RoomSession };
};

/**
 * 缺省值仍为普通牌桌、冻结时钟和不启用生命周期取证。
 * @param hall - 是否大厅场景。
 * @param clock - 可选时钟模式。
 * @param lifecycle - 可选生命周期模式。
 * @returns 原有默认选项。
 */
function tableOptions(hall?: boolean, clock?: CardSpriteClock, lifecycle?: boolean | 'callbacks'): TableOptions {
  return { hall: Boolean(hall), clock: clock ?? 'frozen', lifecycle: lifecycle ?? false };
}

/**
 * 独立对照才使用原生时间。
 * @param page - 当前牌桌。
 * @param clock - 时钟模式。
 */
function prepareTableClock(page: Page, clock: CardSpriteClock): void {
  if (clock === 'normal') useNormalCardSpriteClock(page);
}

/**
 * 保留失败现场、截图及冻结与恢复后的牌面诊断，始终保留原始失败。
 * @param page - 当前牌桌。
 * @param info - 用例附件上下文。
 * @param diagnostics - 连接诊断采集器。
 * @param error - 原始失败。
 */
async function saveTableFailure(page: Page, info: TestInfo,
  diagnostics: Awaited<ReturnType<typeof installConnectionDiagnostics>>, error: unknown): Promise<void> {
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
}

/**
 * 按原顺序登录、创建隔离房间、连接并开始动画采样。
 * @param runtime - 本轮独立页面、房间登记和场景选项。
 */
async function prepareAndSampleTable(runtime: TableRuntime): Promise<void> {
  const { page, info, game, proxy, task, viewport, registration, hall, clock, lifecycle } = runtime;
  if (game === 'texas') await installCardSpriteDiagnostics(page, lifecycle, info);
  recordDiagnostic(page, '初始化大厅');
  console.log(`TABLE > ${game}/${info.project.name} 初始化大厅`);
  await openApplication(page.context(), page, info, `signed_in_${game}_pre_game`);
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
    registration.room = created;
    recordDiagnostic(page, '建房成功', { roomId: created.roomId, node: diagnosticNode(created.apiOrigin) });
    writeFileSync(info.outputPath('created-room.json'), JSON.stringify({ roomId: created.roomId, apiNode: diagnosticNode(created.apiOrigin) }));
  };
  const room = await createRoomWithRetry(page, game, registerRoom, /** 向建房重试器返回本次已创建的房间资料。 */ () => registration.room,
    /** 提供代理诊断快照，缺失时标记取证不完整。 */ async () => await proxy.diagnostics?.() ?? { events: [], dropped: 1 });
  registration.room = room;
  recordDiagnostic(page, '等待牌桌连接及订阅就绪');
  await enterSampleTable(page, room, game, hall);
  await expect(visible(page, 'game-splash-screen-bg')).toBeHidden({ timeout: 90_000 });
  await freezeSampleTable(page, clock);
  console.log('TABLE > 牌桌已就绪，开始动画采样');
  await sampleTable(page, info, room, viewport, task);
}

/**
 * 大厅夹具沿用真实进房，其余场景等待牌桌连接。
 * @param page - 当前页面。
 * @param room - 本轮房间。
 * @param game - 游戏名称。
 * @param hall - 是否大厅场景。
 */
async function enterSampleTable(page: Page, room: RoomSession, game: 'texas' | 'zhajinhua', hall: boolean): Promise<void> {
  const prefix = game === 'texas' ? 'texas-holdem' : 'zhajinhua';
  if (hall) await enterTexasRoom(page, room);
  else await waitForTableConnection(page, game, prefix);
}

/**
 * 普通动画仍使用原网络时钟和冻结策略。
 * @param page - 当前页面。
 * @param clock - 时钟模式。
 */
async function freezeSampleTable(page: Page, clock: CardSpriteClock): Promise<void> {
  if (clock === 'frozen') {
    paceNetworkClock(page);
    await freeze(page);
  }
}
