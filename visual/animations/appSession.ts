/** 动画场景初始化及可点击位置检查，记录操作和遮挡现场。 */
import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { dismissSignedInPopups, ensureAppReadyPastStaging, waitForSignInState } from '../src/support/authFlow';
import { applyContentStabilizers } from '../src/support/pageStabilizers';
import { CLOCK_START } from './timeline';
import { recordDiagnostic, recordBlockedTarget } from '../src/support/connectionDiagnostics';

/**
 * 定位当前显示的真实入口，避免命中导航保留的隐藏页面。
 * @param page - 当前页面。
 * @param id - 业务控件标记。
 */
export const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();

/**
 * 在实际可见且未被遮挡的位置发送鼠标点击，避免冻结时钟后自动滚动等待下一帧。
 * @param target - 当前真实业务控件。
 */
export async function pressTarget(target: Locator): Promise<void> {
  const page = target.page();
  recordDiagnostic(page, '点击控件', { target: String(target) });
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  let point: { x: number; y: number } | null = null;
  try {
    await expect.poll(async () => {
      point = await target.evaluate(node => {
        const box = node.getBoundingClientRect();
        const left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
        const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
        // 遮罩的一部分会被面板盖住，只点击真实命中该控件的可见位置。
        for (const y of [0.5, 0.1, 0.9, 0.25, 0.75]) {
          for (const x of [0.5, 0.1, 0.9, 0.25, 0.75]) {
            const point = { x: left + (right - left) * x, y: top + (bottom - top) * y };
            const hit = document.elementFromPoint(point.x, point.y);
            if (right > left && bottom > top && hit && (node === hit || node.contains(hit))) return point;
          }
        }
        return null;
      });

      if (!point) await page.clock.runFor(16);
      return Boolean(point);
    }, { message: `入口必须在视口内且未被遮罩拦截：${target}` }).toBe(true);
  } catch (error) {
    const details = await target.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)),
        Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
      return { rect: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight },
        hit: hit?.closest('[data-testid]')?.getAttribute('data-testid') || hit?.tagName,
        pointerEvents: getComputedStyle(node).pointerEvents };
    }).catch(() => ({ unavailable: true }));
    recordBlockedTarget(page, String(target), details);
    throw error;
  }
  await page.mouse.click(point!.x, point!.y);
}

/**
 * 点击指定业务标记的实际可见位置。
 * @param page - 当前页面。
 * @param id - 业务控件标记。
 */
export async function press(page: Page, id: string): Promise<void> {
  await pressTarget(visible(page, id));
}

/**
 * 将实际加载的部署版本写入报告；部署任务指定版本时，拒绝跨版本采样。
 * @param page - 刚加载正常 staging HTML 的页面。
 * @param info - 本轮用例报告。
 */
export async function recordApplicationBuild(page: Page, info: TestInfo): Promise<void> {
  const version = await page.locator('meta[name="build-version"]').getAttribute('content');
  expect(version, '正常部署必须提供构建版本').toMatch(/^[a-f0-9]{40}/i);
  await info.attach('application-build', { body: version!, contentType: 'text/plain' });
  if (process.env.CLRN_EXPECTED_APPLICATION_COMMIT) {
    expect(version!.slice(0, 40)).toBe(process.env.CLRN_EXPECTED_APPLICATION_COMMIT);
  }
}

/**
 * 沿用网络边界夹具初始化应用，保留全部真实动画及正常登录校验。
 * @param context - 浏览器上下文。
 * @param page - 当前页面。
 * @param info - 视口与运行信息。
 * @param pageLabel - 现有场景名称。
 * @param proxy - 是否使用牌桌独立代理。
 */
export async function openApplication(context: BrowserContext, page: Page, info: TestInfo,
  pageLabel = 'signed_in_hall', proxy = false) {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'all' })
    .find(item => item.pageLabel === pageLabel && item.viewport.label === info.project.name);
  if (!scenario) throw new Error(`缺少动画基础场景 ${pageLabel}/${info.project.name}`);
  await setupContextForScenario(context, scenario, page, { animations: 'allow', useMitmproxy: proxy });
  await page.clock.install({ time: CLOCK_START });
  await page.goto('/');
  await recordApplicationBuild(page, info);
  await ensureAppReadyPastStaging(page);
  if (scenario.signIn) {
    expect(await waitForSignInState(page, { requestTimeoutMs: 30_000, requireAppState: true }),
      '动画场景必须使用本轮有效登录态，并确认页面已接受注入态').toBe('signedIn');
    await dismissSignedInPopups(page);
  }
  await applyContentStabilizers(page, { ...scenario, hideSelectors: [] });
  return scenario;
}

/**
 * 通过实际入口导航，等待上一段动画结束后再执行下一步准备操作。
 * @param page - 当前页面。
 * @param ids - 按顺序点击的业务标记。
 */
export async function navigate(page: Page, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    await press(page, id);
    await page.waitForTimeout(1200);
  }
}
