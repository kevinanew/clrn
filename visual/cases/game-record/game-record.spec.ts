import fs from 'node:fs';
import { test, expect, type RecordProxy } from './proxy';
import { buildScenarios } from '../../scenarios';
import { AUTH_STATE_PATH, buildStorageStateForScenario, setupContextForScenario } from '../../src/support/pageSetup';
import { preparePage } from '../../src/support/preparePage';
import { visualBaseUrl } from '../../target';
import { back, captureStates, click, holdListDeadline, row, scrollList, swipe, visible } from './ui';
import { captureDetails } from './details';
import type { Page } from '@playwright/test';

async function reopen(page: Page): Promise<void> {
  await back(page);
  await click(page, 'game-record');
}

async function selections(page: Page, version: 'legacy' | 'v2',
  snapshot: (state: string) => Promise<void>): Promise<void> {
  const header = version === 'legacy' ? 'header-right-button' : 'navigation-bar-right-button';
  await click(page, header);
  const score = visible(page, 'record-sum-score-text');
  await expect(score).toHaveText('0');
  await snapshot('select_none');
  const select = (key: string, index: number) => version === 'v2'
    ? visible(page, `select-record-visual-record-${key}-button`)
    : visible(page, 'select-status-button').nth(index);
  await select('private', 0).click({ noWaitAfter: true });
  await expect(score).toHaveText('+180');
  await snapshot('select_win');
  await select('private', 0).click({ noWaitAfter: true });
  await select('club', 1).click({ noWaitAfter: true });
  await expect(score).toHaveText('-90');
  await snapshot('select_loss');
  await click(page, 'game-record-list-select-all-button');
  await expect(score).toHaveText('-1.2m');
  await snapshot('select_all');
  await click(page, 'game-record-list-select-all-button');
  await expect(score).toHaveText('0');
  await snapshot('select_clear');
  await click(page, header);
  await expect(score).toHaveCount(0);
  await snapshot('select_cancel');
}

async function deletion(page: Page, version: 'legacy' | 'v2',
  snapshot: (state: string) => Promise<void>): Promise<void> {
  await swipe(page, row(page, 'Private Texas', version));
  // 隐藏行中的按钮只有侧滑后才处于点击范围。
  const target = visible(page, 'delete-button').first();
  await expect(target).toBeVisible();
  await snapshot('swipe_delete');
  await target.click({ noWaitAfter: true });
  await expect(visible(page, 'alert-custom-button')).toHaveCount(2);
  await snapshot('delete_confirm');
  await visible(page, 'alert-custom-button').first().click({ noWaitAfter: true });
  await expect(visible(page, 'alert-message-text')).toHaveCount(0);
  await snapshot('delete_cancel');
  await target.click({ noWaitAfter: true });
  await visible(page, 'alert-custom-button').last().click({ noWaitAfter: true });
  await expect(visible(page, 'alert-custom-button')).toHaveCount(1);
  await expect(visible(page, 'alert-message-text')).toContainText(/删除|刪除|delete/i);
  await snapshot('delete_blocked');
  await click(page, 'alert-custom-button');
  await row(page, 'Private Texas', version).click({ noWaitAfter: true });
  await expect(visible(page, 'detail-button')).toBeVisible();
  await back(page);
}

async function legacyEnd(page: Page, proxy: RecordProxy,
  snapshot: (state: string) => Promise<void>): Promise<void> {
  await scrollList(page, false);
  await swipe(page, row(page, 'Club Cards', 'legacy'));
  await visible(page, 'delete-button').nth(1).click({ noWaitAfter: true });
  await visible(page, 'alert-custom-button').last().click({ noWaitAfter: true });
  await expect.poll(async () => (await proxy.status()).deleted).toContain('visual-record-club');
  await expect(row(page, 'Club Cards', 'legacy')).toHaveCount(0);
  await snapshot('delete_success');
  await proxy.mode('delete-error');
  await swipe(page, row(page, 'Hall Texas', 'legacy'));
  await visible(page, 'delete-button').nth(1).click({ noWaitAfter: true });
  await visible(page, 'alert-custom-button').last().click({ noWaitAfter: true });
  await expect(visible(page, 'alert-custom-button')).toHaveCount(1);
  await expect(visible(page, 'alert-message-text')).toHaveText('Visual record service unavailable');
  await snapshot('delete_failure');
  await click(page, 'alert-custom-button');
  await proxy.mode('paged', true);
  await reopen(page);
  await expect(row(page, 'Paged Texas 01', 'legacy')).toBeVisible();
  await expect(visible(page, 'progress-hud-activity-indicator')).toHaveCount(0);
  await holdListDeadline(page, true);
  await scrollList(page, true);
  await expect(visible(page, 'pull-up-activity-indicator')).toBeVisible();
  await snapshot('pagination_loading');
  await proxy.release();
  await holdListDeadline(page, false);
  await expect(visible(page, 'pull-up-activity-indicator')).toHaveCount(0);
  await scrollList(page, true);
  await expect(row(page, 'Long Room Name', 'legacy')).toBeVisible();
  await expect(row(page, 'Long Room Name', 'legacy')).toHaveCount(1);
  await snapshot('pagination_end');
  await proxy.mode('list');
  await reopen(page);
  await expect(row(page, 'Private Texas', 'legacy')).toBeVisible();
  await expect(row(page, 'Paged Texas 01', 'legacy')).toHaveCount(0);
  await expect(visible(page, 'progress-hud-activity-indicator')).toHaveCount(0);
  await snapshot('reopen');
}

for (const scenario of buildScenarios().filter(item => item.group === 'game-record')) {
  test(scenario.label, async ({ browser, recordProxy }) => {
    test.setTimeout(900_000);
    const version = scenario.pageLabel.endsWith('legacy') ? 'legacy' : 'v2';
    const auth = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const userId = JSON.parse(auth.entries['save.user.origin.data.from.server.key']).user_id;
    await recordProxy.configure(userId, version, 'empty', true);
    const context = await browser.newContext({
      viewport: scenario.viewport, locale: 'en-US', deviceScaleFactor: 1,
      hasTouch: true,
      proxy: { server: recordProxy.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
      storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { snapshot, complete } = captureStates(page, scenario);
    try {
      await setupContextForScenario(context, scenario, page, { useMitmproxy: true });
      await context.addInitScript(newVersion => {
        localStorage.setItem('use.new.game.record.key', String(newVersion));
      }, version === 'v2');
      await page.goto(scenario.path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      // 新版列表依赖俱乐部页加载的缓存；通过真实导航建立该前置状态。
      await preparePage(page, { ...scenario, tabTestId: 'club-tab', visualReadySelector: '[data-testid="club-tab-screen"]' });
      await expect.poll(async () => (await recordProxy.status()).recordRequests['/v10/club'] ?? 0).toBeGreaterThan(0);
      await preparePage(page, scenario);
      await holdListDeadline(page, true);
      await click(page, 'game-record');
      await expect(visible(page, version === 'legacy' ? 'progress-hud-activity-indicator' : 'loading-indicator')).toBeVisible();
      await snapshot('loading');
      await recordProxy.release();
      await holdListDeadline(page, false);
      await expect(visible(page, 'no-records-text')).toBeVisible();
      await snapshot('empty');
      await recordProxy.mode('list');
      await reopen(page);
      await expect(row(page, 'Private Texas', version)).toBeVisible();
      await expect(visible(page, 'club-game-text')).toHaveCount(1);
      await expect(visible(page, 'club-game-text')).toContainText('Visual Club');
      await snapshot('list');
      await scrollList(page, true);
      await expect(row(page, 'Long Room Name', version)).toBeVisible();
      await snapshot('list_bottom');
      await scrollList(page, false);
      await selections(page, version, snapshot);
      await deletion(page, version, snapshot);
      await captureDetails(page, version, snapshot, recordProxy);
      if (version === 'legacy') {
        await legacyEnd(page, recordProxy, snapshot);
      } else {
        await recordProxy.mode('list-error');
        await reopen(page);
        await expect(visible(page, 'alert-custom-button')).toHaveCount(2);
        await expect(visible(page, 'alert-message-text')).toHaveText('Request failed with status code 503');
        await snapshot('list_failure');
        const endpoint = `/v11/game_log/${userId}/play_session_record/recent`;
        const beforeRetry = (await recordProxy.status()).recordRequests[endpoint];
        await recordProxy.mode('list');
        await visible(page, 'alert-custom-button').last().click({ noWaitAfter: true });
        await expect.poll(async () => (await recordProxy.status()).recordRequests[endpoint]).toBeGreaterThan(beforeRetry);
        await expect(visible(page, 'loading-indicator')).toHaveCount(0);
        await expect(row(page, 'Private Texas', version)).toBeVisible();
        await snapshot('retry_success');
        await recordProxy.mode('detail-error');
        await row(page, 'Private Texas', version).click({ noWaitAfter: true });
        await expect(visible(page, 'alert-custom-button')).toHaveCount(1);
        await expect(visible(page, 'alert-message-text')).toHaveText('Visual record service unavailable');
        await snapshot('detail_failure');
        await click(page, 'alert-custom-button');
      }
      complete();
      expect(errors, '战绩流程不能出现未捕获的页面异常').toEqual([]);
      const status = await recordProxy.status();
      if (version === 'v2') expect(status.deleted).toEqual([]);
      expect(Object.keys(status.recordRequests).length).toBeGreaterThan(5);
      expect(status.recordRequests[`/v1/game_log/user/${userId}/room/visual-record-private`] ?? 0).toBe(0);
      const faults = version === 'legacy'
        ? [`/v1/game_log/user/${userId}/room/visual-record-hall`]
        : [`/v11/game_log/${userId}/play_session_record/recent`,
          `/v11/game_log/${userId}/play_session_record/visual-record-private`];
      for (const endpoint of faults) expect(status.faultRequests[endpoint] ?? 0).toBeGreaterThan(0);
    } finally {
      const alerts = await visible(page, 'alert-message-text').allTextContents().catch(() => []);
      if (alerts.length) console.error(`RECORD ALERT > ${JSON.stringify(alerts)}`);
      await recordProxy.release();
      console.log(`RECORD MITMPROXY > ${JSON.stringify((await recordProxy.status()).recordRequests)}`);
      await context.close();
    }
  });
}
