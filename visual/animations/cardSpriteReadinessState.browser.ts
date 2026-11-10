/** 覆盖牌面资源、翻转中间态、视口边界与解码异常传播。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { launchAnimationBrowser } from './appSessionBrowser';
import { cardSpriteReadinessState, decodeCardSpriteImages } from './cardSpriteReadinessState';

const selector = '[data-testid="community_card"]';
const image = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='85' height='124'/%3E`;
type Fixture = { card: string; face: string; container: string; fallback: string; content: string; clipper: string; source: string };

/**
 * 保留真实 DOM、图片解码与 CSS 布局，参数只控制当前待验证的状态。
 * @param overrides - 当前用例改变的状态。
 * @returns 可直接装载的离线页面。
 */
function markup(overrides: Partial<Fixture>): string {
  const state = { card: '', face: '', container: '', fallback: 'display:none', content: 'opacity:1',
    clipper: 'transform:scale(1)', source: image, ...overrides };
  return `<style>body{margin:0}</style><div data-testid="community_card" style="width:45px;height:68px;${state.card}">
    <div data-testid="card-flip" data-side="1"><div data-testid="card-flip-side-b" style="${state.face}">
      <div data-testid="sprite-image-container" style="width:45px;height:68px;${state.container}">
        <div data-testid="sprite-image-fallback" style="${state.fallback}">文字回退</div>
        <div data-testid="sprite-image-content" style="${state.content}">
          <div data-testid="sprite-image-clipper" style="${state.clipper}">
            <div data-testid="sprite-image-view"><img src="${state.source}"></div>
          </div>
        </div>
      </div>
    </div></div></div>`;
}

const readyStates: Partial<Fixture>[] = [
  {},
  { card: 'display:none', source: '' },
  { card: 'position:absolute;left:-45px', source: '' },
  { card: 'position:absolute;top:-68px', source: '' },
  { card: 'position:absolute;left:375px', source: '' },
  { card: 'position:absolute;top:812px', source: '' },
  { face: 'opacity:0', fallback: 'display:flex', content: 'opacity:0', clipper: 'transform:scale(0)' },
  { face: 'transform:scaleX(0.49)', fallback: 'display:flex', content: 'opacity:0' },
];

const pendingStates: Partial<Fixture>[] = [
  { source: '' },
  { container: 'width:0' },
  { container: 'height:0' },
  { clipper: 'transform:none' },
  { clipper: 'transform:scaleX(0.001)' },
  { clipper: 'transform:scaleY(0.001)' },
  { fallback: 'display:flex' },
  { content: 'opacity:0.99' },
  { face: 'transform:scaleX(0.5)', fallback: 'display:flex' },
];

test('资源、翻转相位和视口边界分别决定是否需要等待，不改写 DOM 或推进时钟', /** 使用真实 Chromium 检查所有判定边界。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    for (const state of readyStates) await assertState(page, state, 0);
    for (const state of pendingStates) await assertState(page, state, 1);
    await page.setContent('<div></div>');
    assert.deepEqual(await page.evaluate(cardSpriteReadinessState, selector), ['目标牌面图集尚未挂载']);
  } finally { await browser.close(); }
});

/**
 * 核对诊断、时钟和只读边界。
 * @param page - 离线浏览器页面。
 * @param state - 当前牌面状态。
 * @param expected - 应产生的未就绪诊断数量。
 */
async function assertState(page: import('@playwright/test').Page, state: Partial<Fixture>, expected: number): Promise<void> {
  await page.setContent(markup(state));
  await page.evaluate(decodeCardSpriteImages, selector);
  const before = await page.content();
  const messages = await page.evaluate(cardSpriteReadinessState, selector);
  assert.equal(messages.length, expected, JSON.stringify({ state, messages }));
  assert.equal(await page.content(), before, '只读检查不得修改牌面');
  assert.equal(await page.evaluate(/** 读取冻结时刻。 */ () => Date.now()), Date.parse('2026-01-01T00:00:01Z'));
}

test('解码失败先记录拒绝再传播同一异常，成功仍记录实际资源来源', /** 验证解码与诊断器的原始交互顺序。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(markup({}));
    await page.evaluate(decodeCardSpriteImages, selector);
    const result = await page.evaluate(/** 保留图片与异常身份，核验实际解码结果。
     * @param decodeSource - 实际解码函数源码。 */ async decodeSource => {
      const events: { outcome: string; source: string }[] = [];
      const state = window as typeof window & { __clrnCardSpriteDecoded: (image: HTMLImageElement, outcome: string, source: string) => Promise<void> };
      state.__clrnCardSpriteDecoded = /** 收集原始解码结果，不替代资源加载。
       * @param _image - 实际图片。
       * @param outcome - 解码结果。
       * @param source - 实际来源。 */ async (_image, outcome, source) => { events.push({ outcome, source }); };
      const decode = (0, eval)(`(${decodeSource})`) as (selector: string) => Promise<void>;
      await decode('[data-testid="community_card"]');
      const failure = new Error('original-decode-failure');
      document.querySelector('img')!.decode = /** 注入一次原始解码拒绝。 */ async () => { throw failure; };
      try { await decode('[data-testid="community_card"]'); }
      catch (error) { return { sameError: error === failure, events }; }
      throw new Error('解码失败未传播');
    }, decodeCardSpriteImages.toString());
    assert.equal(result.sameError, true);
    assert.deepEqual(result.events.map(/** 读取记录顺序。
     * @param event - 解码事件。 */ event => event.outcome), ['fulfilled', 'rejected']);
    assert.ok(result.events.every(/** 诊断必须关联实际资源。
     * @param event - 解码事件。 */ event => event.source === image));
  } finally { await browser.close(); }
});
