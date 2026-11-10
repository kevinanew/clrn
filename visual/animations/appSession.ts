/** 动画场景初始化及可点击位置检查，记录操作和遮挡现场。 */
import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { dismissSignedInPopups, ensureAppReadyPastStaging, waitForSignInState } from '../src/support/authFlow';
import { applyContentStabilizers } from '../src/support/pageStabilizers';
import { CLOCK_START } from './timeline';
import { recordDiagnostic, recordBlockedTarget } from '../src/support/connectionDiagnostics';
import { advanceCardSpriteClock, hasNormalCardSpriteClock } from './cardSpriteClock';
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
  let point: {
    x: number;
    y: number;
  } | null = null;
  try {
    await expect.poll(/** 轮询目标遮罩的真实可点击区域，等待遮挡消失。 */ async () => {
      point = await target.evaluate(/** 计算目标在视口内的可命中点，避开被面板遮住的区域。
    * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
        const checks = {
          /** 检查目标在视口内是否具有非零可点击面积。 */
          hasArea(): boolean { return right > left && bottom > top; }
          // 保留纵向优先的 25 个候选点及原点击位置顺序。
        };
        const box = node.getBoundingClientRect();
        const left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
        const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
        if (!checks.hasArea())
          return null;
        // 保留纵向优先的 25 个候选点及原点击位置顺序。
        const points = [0.5, 0.1, 0.9, 0.25, 0.75].flatMap(/** 为当前纵坐标生成候选横坐标。
         * @param y - 纵向比例。 */ y => [0.5, 0.1, 0.9, 0.25, 0.75].map(/** 映射视口中的候选点。
         * @param x - 横向比例。 */ x => ({ x: left + (right - left) * x, y: top + (bottom - top) * y })));
        return points.find(/** 仅接受命中控件自身或后代的候选点。
         * @param point - 待检查坐标。 */ point => {
          const hit = document.elementFromPoint(point.x, point.y);
          return hit !== null && node.contains(hit);
        }) ?? null;
      });
      if (!point)
        await advanceCardSpriteClock(page, 16);
      return Boolean(point);
    }, { message: `入口必须在视口内且未被遮罩拦截：${target}` }).toBe(true);
  }
  catch (error) {
    const details = await target.evaluate(/** 检查元素中心处的命中节点，判断点击是否会被其他元素拦截。
   * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
      const details = {
        /**
         * 优先报告业务标记，再回退为实际命中标签。
         * @param hit - 当前命中节点。
         * @returns 可用于遮挡诊断的名称。
         */
        hitLabel(hit: Element | null): string | undefined {
          if (!hit)
            return undefined;
          return details.businessLabel(hit) || hit.tagName;
        },
        /**
         * 读取最近的业务标记。
         * @param hit - 实际命中节点。
         * @returns 标记或空值。
         */
        businessLabel(hit: Element): string | null | undefined {
          return hit.closest('[data-testid]')?.getAttribute('data-testid');
        }
      };
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
      return { rect: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight },
        hit: details.hitLabel(hit),
        pointerEvents: getComputedStyle(node).pointerEvents };
    }).catch(/** 命中测试失败时返回不可用标记，由上层决定后续处理。 */ () => ({ unavailable: true }));
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
 */
export async function openApplication(context: BrowserContext, page: Page, info: TestInfo, pageLabel = 'signed_in_hall') {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'all' })
    .find(/** 查找满足以下条件的首个条目：`item.pageLabel === pageLabel && item.viewport.label === info.project.name`。
 * @param item - 当前遍历的条目。 */ item => item.pageLabel === pageLabel && item.viewport.label === info.project.name);
  if (!scenario)
    throw new Error(`缺少动画基础场景 ${pageLabel}/${info.project.name}`);
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await installApplicationClock(page);
  await page.goto('/');
  await recordApplicationBuild(page, info);
  await ensureAppReadyPastStaging(page);
  await prepareSignIn(page, scenario.signIn);
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
/**
 * 校验本轮登录并关闭登录后弹层。
 * @param page - 当前应用页面。
 * @param signIn - 场景是否需要登录。
 */
async function prepareSignIn(page: Page, signIn: boolean): Promise<void> {
  if (signIn) {
    expect(await waitForSignInState(page, { requestTimeoutMs: 30000, requireAppState: true }), '动画场景必须使用本轮有效登录态，并确认页面已接受注入态').toBe('signedIn');
    await dismissSignedInPopups(page);
  }
}
/**
 * 冻结策略下安装原始时钟，原生时间模式保留正常计时。
 * @param page - 当前应用页面。
 */
async function installApplicationClock(page: Page): Promise<void> {
  if (!hasNormalCardSpriteClock(page))
    await page.clock.install({ time: CLOCK_START });
}
