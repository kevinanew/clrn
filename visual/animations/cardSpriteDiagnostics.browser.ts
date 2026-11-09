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
  test(`图集诊断保留原始失败、DOM 身份及对照结果：定时回调恢复=${recovers}`, /** 验证图集诊断保留原始失败、DOM 身份及对照结果：定时回调恢复=$\{recovers\}。 */ async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'clrn-card-diagnostics-'));
    const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
      ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
    try {
      const page = await browser.newPage();
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
      await installCardSpriteDiagnostics(page, false, info);
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
      await page.evaluate(/** 注入包含域名与 IP 路径的图片事件，验证附件中的资源地址脱敏。 */ async () => {
        const state = window as typeof window & { __clrnCardSpriteEvent: (entry: unknown) => Promise<void> };
        for (const path of ['/assets/probe.example.invalid/card.png', '/assets/192.0.2.7/card.png',
          '/assets/[2001:db8::7]/card.png', '/assets/probe%2eexample%2einvalid/token=fixture-secret']) {
          await state.__clrnCardSpriteEvent({ event: 'privacy-probe', virtualTime: Date.now(),
            cards: [{ id: 9000, connected: false, image: { path } }] });
        }
      });
      await page.evaluate(/** 按测试条件安排牌面从后备图恢复为精灵内容。
 * @param recovers - 当前操作使用的 recovers。 */ recovers => {
        if (recovers) setTimeout(/** 完成牌面图片恢复的 DOM 提交，触发就绪条件。 */ () => {
          document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
          document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
        }, 16);
      }, recovers);
      const time = await page.evaluate(/** 记录牌面诊断开始前的冻结时刻。 */ () => Date.now());
      await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'),
        /德州可见牌面应显示完整图集/);
      assert.equal(await page.evaluate(/** 读取诊断完成后的时间，确认就绪等待没有推进页面时钟。 */ () => Date.now()), time, '原始等待不得推进动画');
      await saveCardSpriteDiagnostics(page, info, 'frozen');
      const frozenContents = await readFile(path.join(directory, 'card-sprite-diagnostics-frozen.json'), 'utf8');
      const frozen: Report = JSON.parse(frozenContents);
      assert.ok(frozen.failed);
      assert.ok(frozen.entries.some(/** 确认牌面就绪等待失败时写入了诊断记录。
 * @param entry - 当前处理的记录条目。 */ entry => entry.event === 'wait-failed'));
      assert.ok(frozen.entries.some(/** 确认诊断中包含至少一张已成功解码的牌面。
 * @param entry - 当前处理的记录条目。 */ entry => entry.cards.some(/** 识别已成功解码的牌面，核对图集解码状态。
 * @param card - 当前操作使用的 card。 */ card => card.image?.decode === 'fulfilled')));
      assert.doesNotMatch(frozenContents, /probe\.example|192\.0\.2\.7|2001:db8|probe%2e|fixture-secret/);
      assert.match(frozenContents, /asset-[a-f0-9]{16}/, '冻结附件必须使用逻辑资源指纹');
      const original = frozen.entries.flatMap(/** 展开当前条目对应的`entry.cards`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.cards).find(/** 从诊断快照中选择仍连接到文档的牌面节点。
 * @param card - 当前操作使用的 card。 */ card => card.connected)!;
      await observeCardSpriteClockControl(page);
      assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(/** 读取牌面元素的 display 样式，核对可见性诊断。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => getComputedStyle(node).display),
        recovers ? 'none' : 'flex', '诊断不能自行隐藏持续回退的牌面');
      await page.locator('[data-testid="sprite-image-container"]').evaluate(/** 移除原牌面节点，验证诊断能够记录卸载状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.remove());
      await sampleCardSprites(page, 'fixture-removed');
      await saveCardSpriteDiagnostics(page, info);
      const contents = await readFile(path.join(directory, 'card-sprite-diagnostics.json'), 'utf8');
      const report: Report = JSON.parse(contents);
      assert.ok(report.failed, '对照恢复也必须保留原始失败');
      assert.ok(report.entries.some(/** 确认诊断跟踪到了原牌面节点被移除的过程。
 * @param entry - 当前处理的记录条目。 */ entry => entry.cards.some(/** 按原节点标识识别已脱离文档的牌面。
 * @param card - 当前操作使用的 card。 */ card => card.id === original.id && !card.connected)));
      assert.ok(report.entries.some(/** 确认真实控制阶段的观测事件进入牌面诊断。
 * @param entry - 当前处理的记录条目。 */ entry => entry.event.startsWith('control-running-')));
      const control = report.entries.filter(/** 提取控制阶段事件，核对牌面显隐恢复。
 * @param entry - 当前处理的记录条目。 */ entry => entry.event.startsWith('control-running-'));
      assert.ok(control.at(-1)!.virtualTime > control[0].virtualTime, '对照时钟须以正常速度前进');
      assert.ok(control.at(-1)!.realTime > control[0].realTime);
      assert.ok(control.some(/** 确认控制阶段观测到原牌面的预期透明度。
 * @param entry - 当前处理的记录条目。 */ entry => entry.cards.some(/** 按节点标识与预期透明度核对原牌面的恢复状态。
 * @param card - 当前操作使用的 card。 */ card => card.id === original.id
        && card.opacity === (recovers ? '1' : '0'))), '对照须关联原始 DOM 节点');
      assert.doesNotMatch(contents, /private-player-id|private-token|private-text|base64/);
      assert.doesNotMatch(contents, /probe\.example|192\.0\.2\.7|2001:db8|probe%2e|fixture-secret/);
      assert.equal(await readFile(path.join(directory, 'card-sprite-diagnostics-frozen.json'), 'utf8'), frozenContents,
        '对照附件不能覆盖原始冻结现场');
      await page.evaluate(/** 连续采样超过容量上限，验证诊断记录的截断与丢弃计数。 */ async () => {
        const state = window as typeof window & { __clrnSampleCardSprites: (event: string) => Promise<void> };
        for (let index = 0; index < 1005; index++) await state.__clrnSampleCardSprites('capacity');
      });
      await saveCardSpriteDiagnostics(page, info);
      const bounded: Report = JSON.parse(await readFile(path.join(directory, 'card-sprite-diagnostics.json'), 'utf8'));
      assert.equal(bounded.entries.length, 1000);
      assert.ok(bounded.dropped > 0, '历史被截断必须明确计数');
      assert.equal(bounded.entries.at(-1)!.event, 'save', '容量满时仍须保留最新现场');
      const journalContents = await readFile(path.join(directory, 'card-sprite-events.jsonl'), 'utf8');
      const journal = journalContents.trim().split('\n').map(/** 解析持续落盘的牌面诊断日志，核对挂载与失败事件。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
      assert.ok(journal.length > 1000, '完整事件文件不得采用内存截断策略');
      assert.ok(journal.some(/** 确认夹具挂载事件已持续写入日志。
 * @param entry - 当前处理的记录条目。 */ entry => entry.event === 'fixture-mounted'), '保留从挂载开始的早期证据');
      assert.ok(journal.some(/** 确认就绪等待失败事件已持续写入日志。
 * @param entry - 当前处理的记录条目。 */ entry => entry.event === 'wait-failed'), '保留原始失败');
      assert.deepEqual(journal.map(/** 提取日志序号，核对持续落盘事件的顺序。
 * @param entry - 当前处理的记录条目。 */ entry => entry.sequence), journal.map(/** 生成从一开始的连续序号，检查日志没有缺项或重号。
 * @param _entry - 当前操作使用的 _entry。
 * @param index - 当前条目在集合中的位置。 */ (_entry, index) => index + 1));
      assert.doesNotMatch(journalContents, /probe\.example|192\.0\.2\.7|2001:db8|fixture-secret|private-player-id|base64/);
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
