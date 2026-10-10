import { chromium, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildScenarios } from '../../scenarios';
import { visualBaseUrl } from '../../target';
import configuration from '../../playwright.config';
import { buildStorageStateForScenario, setupContextForScenario } from '../../src/support/pageSetup';
import { preparePage } from '../../src/support/preparePage';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import { withTexasProxy, texasProxyOptions, type TexasProxy } from '../../cases/texas-holdem/proxy';
import { createTexasRoom, deleteTexasRoom, enterTexasRoom } from '../../cases/texas-holdem/room';
import { freezeClock, selfId, visible } from '../../cases/texas-holdem/replay';
import { table } from '../../cases/texas-holdem/variantSupport';
import { appliedGameTranslation, gameViewportCorrection } from '../../cases/texas-holdem/viewportAlignment';

const destination = path.resolve(__dirname);
const fullTablePots = [90, 80, 70, 60, 50, 40, 30, 20, 10];
const measurementPath = path.join(destination, 'measurements.json');
const details: Array<{ version: string; filename: string } & Record<string, unknown>> =
  existsSync(measurementPath) ? JSON.parse(readFileSync(measurementPath, 'utf8')) : [];

/**
 * 复用正式截图的视口归零规则，只调整导航偏移。
 * @param page - 当前已进入真实牌桌的浏览器页面。
 */
async function alignGame(page: Page) {
  const game = visible(page, 'run-game-view');
  await game.evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  const geometry = await game.evaluate(node => ({
    top: node.getBoundingClientRect().top,
    translation: (node as HTMLElement).style.getPropertyValue('translate'),
  }));
  const correction = gameViewportCorrection(geometry.top, appliedGameTranslation(geometry.translation));
  await game.evaluate((node, amount) => (node as HTMLElement).style.setProperty('translate', `0 ${amount}px`, 'important'), correction);
}

/**
 * 用相同线上应用、九人消息和浏览器环境，独立采集旧版和当前底池源码。
 * @param proxy - 复用 clrn 德州消息回放规则的网络代理。
 * @param version - 本次截图应使用当前版或修改前底池组件。
 */
async function captureVersion(proxy: TexasProxy, version: 'current' | 'previous') {
  const browser = await chromium.launch(configuration.use?.launchOptions);
  try {
    for (const scenario of buildScenarios().filter(item => item.pageLabel === 'signed_in_texas_table_states')) {
      console.log(`CAPTURE > ${version} ${scenario.label}`);
      const context = await browser.newContext({ ...texasProxyOptions(proxy), baseURL: visualBaseUrl, viewport: scenario.viewport,
        locale: 'en-US', deviceScaleFactor: 1, storageState: buildStorageStateForScenario(scenario, visualBaseUrl) });
      const page = await context.newPage();
      page.on('pageerror', error => console.error(`PAGE ERROR > ${error.message}`));
      let room: Awaited<ReturnType<typeof createTexasRoom>> | undefined;
      try {
        // 宿主机 tsx 会为浏览器回调的局部函数注入命名助手，助手只影响调试名称。
        await context.addInitScript('globalThis.__name = (target) => target;');
        await setupContextForScenario(context, scenario, page, { useMitmproxy: true });
        // 两版仅在网络边界替换底池源码，应用仍完成正常初始化和真实入房。
        await context.route('**/_expo/static/js/web/index-*.js', route => route.fulfill({
          contentType: 'application/javascript', body: readFileSync(path.join(destination, '.prepared-bundles', `${version}.js`), 'utf8'),
        }));
        await page.clock.install({ time: Date.now() });
        await proxy.configureGuestView();
        await page.goto(scenario.path);
        await preparePage(page, scenario);
        room = await createTexasRoom(page, created => {
          room = created;
          writeFileSync(path.join(destination, 'created-room.json'), JSON.stringify({ roomId: created.roomId, apiOrigin: created.apiOrigin }));
        });
        await enterTexasRoom(page, room);
        await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
        await expect.poll(async () => {
          const retry = visible(page, 'common-alert-button-retry');
          if (await retry.isVisible()) await retry.click();
          return !(await visible(page, 'game-splash-screen-bg').isVisible());
        }, { timeout: 90_000 }).toBe(true);
        await freezeClock(page);
        const self = await selfId(page);
        for (const [state, pots] of [['full-table-two-pots', [120, 60]], ['full-table-full-pots', fullTablePots]] as const) {
          await table(page, proxy, room.roomId, self, { full: true, pots: [...pots] });
          await expect(page.locator('[data-testid^="texas-holdem-player-container-"]:visible')).toHaveCount(9);
          await expect(visible(page, 'texas_holdem_main_pot_amount')).toHaveText(String([...pots].reduce((total, amount) => total + amount, 0)));
          await expect(page.locator('[data-testid^="texas_holdem_side_pot_"]')).toHaveCount(pots.length);
          await page.clock.runFor(500);
          await alignGame(page);
          await ensureLocalImagesLoaded(page);
          const directory = path.join(destination, version);
          mkdirSync(directory, { recursive: true });
          const filename = `${scenario.locale}-${scenario.viewport.label}-${state}.png`;
          await page.screenshot({ path: path.join(directory, filename), animations: 'disabled', caret: 'hide', scale: 'css' });
          const geometry = await page.locator('[data-testid="texas_holdem_pots_container"]:visible').last().evaluate(node => {
            const rectangle = node.getBoundingClientRect();
            return { container: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height },
              pots: Array.from(node.querySelectorAll('[data-testid^="texas_holdem_side_pot_"]')).map(item => {
                const bounds = item.getBoundingClientRect();
                return { amount: item.textContent, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
              }) };
          });
          const previousMeasurement = details.findIndex(item => item.version === version && item.filename === filename);
          if (previousMeasurement >= 0) details.splice(previousMeasurement, 1);
          details.push({ version, filename, viewport: scenario.viewport, pots, geometry });
          writeFileSync(measurementPath, JSON.stringify(details, null, 2));
          console.log(`SAVED > ${version}/${filename}`);
        }
      } catch (error) {
        await page.screenshot({ path: path.join(destination, `${version}-${scenario.viewport.label}-failure.png`) }).catch(() => undefined);
        throw error;
      } finally {
        try { if (room) await deleteTexasRoom(room); }
        finally {
          try { await proxy.releaseTexas(); }
          finally { await context.close(); }
        }
      }
    }
  } finally { await browser.close(); }
}

/** 当前版先建立满桌满底池截图，再按同一流程回放修改前源码。 */
async function main() {
  await withTexasProxy(async proxy => {
    if (process.env.COMPARISON_VERSION !== 'previous') await captureVersion(proxy, 'current');
    if (process.env.COMPARISON_VERSION !== 'current') await captureVersion(proxy, 'previous');
  });
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
