/** 图集诊断的浏览器回归：时钟对照只能收集证据，不能把原始失败转成通过。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { installCardSpriteDiagnostics, observeCardSpriteClockControl,
  sampleCardSprites, saveCardSpriteDiagnostics } from './cardSpriteDiagnostics';
import { waitForTexasCardSprites } from './cardSpriteReadiness';

type Card = { id: number; connected: boolean; fallback?: string; opacity?: string; image?: { decode: string } };
type Report = { failed: boolean; dropped: number; entries: {
  realTime: number; virtualTime: number; event: string; cards: Card[];
}[] };

for (const recovers of [true, false]) {
  test(`图集诊断保留原始失败、DOM 身份及对照结果：定时回调恢复=${recovers}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'clrn-card-diagnostics-'));
    const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
      ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
    try {
      const page = await browser.newPage();
      await installCardSpriteDiagnostics(page);
      await page.goto('about:blank');
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      const bitmap = new PNG({ width: 85, height: 124 });
      bitmap.data.fill(255);
      const source = `data:image/png;base64,${PNG.sync.write(bitmap).toString('base64')}`;
      await page.setContent(`<meta name="build-version" content="${'a'.repeat(40)}">
        <div data-testid="texas-holdem-player-container-private-player-id" data-secret="private-token">
          <div data-testid="community_card" style="width:45px;height:68px">
            <div data-testid="sprite-image-container" style="width:45px;height:68px">
              <div data-testid="sprite-image-fallback" style="display:flex">private-text</div>
              <div data-testid="sprite-image-content" style="opacity:0">
                <div data-testid="sprite-image-clipper" style="transform:scale(0.5)">
                  <div data-testid="sprite-image-view"><img src="${source}"></div>
                </div>
              </div>
            </div>
          </div>
        </div>`);
      await sampleCardSprites(page, 'fixture-mounted');
      await page.evaluate(async () => {
        const state = window as typeof window & { __clrnCardSpriteEvent: (entry: unknown) => Promise<void> };
        for (const path of ['/assets/probe.example.invalid/card.png', '/assets/192.0.2.7/card.png',
          '/assets/[2001:db8::7]/card.png', '/assets/probe%2eexample%2einvalid/token=fixture-secret']) {
          await state.__clrnCardSpriteEvent({ event: 'privacy-probe', virtualTime: Date.now(),
            cards: [{ id: 9000, connected: false, image: { path } }] });
        }
      });
      await page.evaluate(recovers => {
        if (recovers) setTimeout(() => {
          document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
          document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
        }, 16);
      }, recovers);
      const time = await page.evaluate(() => Date.now());
      await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'),
        /德州可见牌面应显示完整图集/);
      assert.equal(await page.evaluate(() => Date.now()), time, '原始等待不得推进动画');
      const info = {
        project: { name: 'offline' }, repeatEachIndex: 0, retry: 0,
        /**
         * 本用例附件写入临时目录。
         * @param name - 附件文件名。
         */
        outputPath: (name: string) => path.join(directory, name),
        /** 本回归直接读取附件文件。 */
        attach: async () => {},
      } as unknown as TestInfo;
      await saveCardSpriteDiagnostics(page, info, 'frozen');
      const frozenContents = await readFile(path.join(directory, 'card-sprite-diagnostics-frozen.json'), 'utf8');
      const frozen: Report = JSON.parse(frozenContents);
      assert.ok(frozen.failed);
      assert.ok(frozen.entries.some(entry => entry.event === 'wait-failed'));
      assert.ok(frozen.entries.some(entry => entry.cards.some(card => card.image?.decode === 'fulfilled')));
      assert.doesNotMatch(frozenContents, /probe\.example|192\.0\.2\.7|2001:db8|probe%2e|fixture-secret/);
      assert.match(frozenContents, /asset-[a-f0-9]{16}/, '冻结附件必须使用逻辑资源指纹');
      const original = frozen.entries.flatMap(entry => entry.cards).find(card => card.connected)!;
      await observeCardSpriteClockControl(page);
      assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => getComputedStyle(node).display),
        recovers ? 'none' : 'flex', '诊断不能自行隐藏持续回退的牌面');
      await page.locator('[data-testid="sprite-image-container"]').evaluate(node => node.remove());
      await sampleCardSprites(page, 'fixture-removed');
      await saveCardSpriteDiagnostics(page, info);
      const contents = await readFile(path.join(directory, 'card-sprite-diagnostics.json'), 'utf8');
      const report: Report = JSON.parse(contents);
      assert.ok(report.failed, '对照恢复也必须保留原始失败');
      assert.ok(report.entries.some(entry => entry.cards.some(card => card.id === original.id && !card.connected)));
      assert.ok(report.entries.some(entry => entry.event.startsWith('control-running-')));
      const control = report.entries.filter(entry => entry.event.startsWith('control-running-'));
      assert.ok(control.at(-1)!.virtualTime > control[0].virtualTime, '对照时钟须以正常速度前进');
      assert.ok(control.at(-1)!.realTime > control[0].realTime);
      assert.ok(control.some(entry => entry.cards.some(card => card.id === original.id
        && card.opacity === (recovers ? '1' : '0'))), '对照须关联原始 DOM 节点');
      assert.doesNotMatch(contents, /private-player-id|private-token|private-text|base64/);
      assert.doesNotMatch(contents, /probe\.example|192\.0\.2\.7|2001:db8|probe%2e|fixture-secret/);
      assert.equal(await readFile(path.join(directory, 'card-sprite-diagnostics-frozen.json'), 'utf8'), frozenContents,
        '对照附件不能覆盖原始冻结现场');
      await page.evaluate(async () => {
        const state = window as typeof window & { __clrnSampleCardSprites: (event: string) => Promise<void> };
        for (let index = 0; index < 1005; index++) await state.__clrnSampleCardSprites('capacity');
      });
      await saveCardSpriteDiagnostics(page, info);
      const bounded: Report = JSON.parse(await readFile(path.join(directory, 'card-sprite-diagnostics.json'), 'utf8'));
      assert.equal(bounded.entries.length, 1000);
      assert.ok(bounded.dropped > 0, '历史被截断必须明确计数');
      assert.equal(bounded.entries.at(-1)!.event, 'save', '容量满时仍须保留最新现场');
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
