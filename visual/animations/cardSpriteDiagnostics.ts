/** 图集诊断只观察 DOM；不改写牌面状态，不把时钟对照的恢复当作测试通过。 */
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { diagnosticText } from '../../e2e/helpers/diagnostic-privacy';
import { cardSpriteResource } from './cardSpritePrivacy';
import { hasNormalCardSpriteClock } from './cardSpriteClock';
import { installCardSpriteLifecycle } from './cardSpriteLifecycle';

type Entry = { realTime: number; event: string; virtualTime: number; cards: unknown[] };
type Recording = { entries: Entry[]; dropped: number; failed: boolean };
const recordings = new WeakMap<Page, Recording>();
const limit = 1000;

/**
 * 在导航前安装有界采集，使用宿主时间标注浏览器事件到达时间。
 * @param page - 尚未导航、属于本例的页面。
 * @param lifecycle - 仅在独立取证中观察 React 提交；不把不支持的构建视为已观察。
 */
export async function installCardSpriteDiagnostics(page: Page, lifecycle = false): Promise<void> {
  const recording: Recording = { entries: [], dropped: 0, failed: false };
  recordings.set(page, recording);
  await page.exposeBinding('__clrnCardSpriteEvent', (_source, entry: Omit<Entry, 'realTime'>) => {
    if (recording.entries.length === limit) { recording.entries.shift(); recording.dropped++; }
    // 在宿主持久化边界替换路径；浏览器不能把嵌在相对路径里的地址带进附件。
    const cards = entry.cards.map(value => {
      const card = value as { image?: { path?: unknown } };
      return { ...card, ...(card.image ? { image: { ...card.image, path: cardSpriteResource(card.image.path) } } : {}) };
    });
    recording.entries.push({ ...entry, cards, realTime: Date.now() });
  });
  // 字符串避免 tsx 的运行时助手进入浏览器。仅输出自建编号、资源路径和显示属性。
  await page.addInitScript(`(() => {
    const ids = new WeakMap();
    let sequence = 0;
    const id = node => {
      if (!node) return null;
      if (!ids.has(node)) ids.set(node, ++sequence);
      return ids.get(node);
    };
    const selector = '[data-testid="sprite-image-container"], [data-testid="sprite-image-fallback-container"]';
    let previous = new Map();
    let previousNodes = new Map();
    const decoded = new WeakMap();
    const snapshot = node => {
      const image = node.querySelector('[data-testid="sprite-image-view"] img');
      const fallback = node.querySelector('[data-testid="sprite-image-fallback"]');
      const content = node.querySelector('[data-testid="sprite-image-content"]');
      const clipper = node.querySelector('[data-testid="sprite-image-clipper"]');
      const slot = node.closest('[data-testid="community_card"], [data-testid="texas-holdem-player-hole-cards"]');
      const flip = node.closest('[data-testid="card-flip"]');
      const face = node.closest('[data-testid="card-flip-side-b"]');
      const box = node.getBoundingClientRect();
      const decoding = image ? decoded.get(image) : null;
      let path = null;
      if (image) {
        try {
          const url = new URL(image.currentSrc || image.src, location.href);
          path = /^https?:$/.test(url.protocol) ? url.pathname : '[' + url.protocol + ']';
        } catch { path = '[invalid]'; }
      }
      return { id: id(node), slot: id(slot), slotType: slot?.getAttribute('data-testid') ?? null,
        lifecycle: window.__clrnCardSpriteLifecycle?.(node) ?? { status: 'not-enabled' },
        imageId: id(image), connected: node.isConnected, kind: node.getAttribute('data-testid'),
        visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        box: { x: box.x, y: box.y, width: box.width, height: box.height }, width: node.offsetWidth,
        fallback: fallback ? getComputedStyle(fallback).display : null,
        opacity: content ? getComputedStyle(content).opacity : null,
        transform: clipper ? getComputedStyle(clipper).transform : null,
        flipSide: flip?.getAttribute('data-side') ?? null,
        faceOpacity: face ? getComputedStyle(face).opacity : null,
        image: image ? { path, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
          decode: decoding?.source === (image.currentSrc || image.src) ? decoding.outcome : 'unobserved' } : null };
    };
    const emit = (event, force = false) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const current = new Map(nodes.map(node => [id(node), snapshot(node)]));
      const cards = [];
      for (const [key, card] of current) {
        if (force || JSON.stringify(card) !== JSON.stringify(previous.get(key))) cards.push(card);
      }
      for (const [key, card] of previous) {
        if (!current.has(key)) cards.push({ id: key, connected: false, imageId: card.imageId, slot: card.slot,
          lifecycle: window.__clrnCardSpriteLifecycle?.(previousNodes.get(key)) ?? card.lifecycle });
      }
      previous = current;
      previousNodes = new Map(nodes.map(node => [id(node), node]));
      if (force || cards.length) return window.__clrnCardSpriteEvent({ event, virtualTime: Date.now(), cards }).catch(() => {});
    };
    window.__clrnSampleCardSprites = event => emit(event, true);
    window.__clrnCardSpriteDecoded = (image, outcome, source) => {
      decoded.set(image, { outcome, source });
      return emit('decode-' + outcome, true);
    };
    const layout = new ResizeObserver(() => emit('layout'));
    const observed = new Set();
    new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) {
        for (const node of observed) {
          if (!node.isConnected) { layout.unobserve(node); observed.delete(node); }
        }
        for (const node of document.querySelectorAll(selector)) {
          if (!observed.has(node)) { observed.add(node); layout.observe(node); }
        }
      }
      emit('dom-change');
    }).observe(document,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'src', 'data-side'] });
    for (const event of ['load', 'error']) document.addEventListener(event, e => {
      if (e.target instanceof HTMLImageElement && e.target.closest(selector)) emit('image-' + event, true);
    }, true);
  })();`);
  if (lifecycle) await installCardSpriteLifecycle(page);
}

/**
 * 记录回放边界或解码阶段，关联同一 DOM 身份的前后变化。
 * @param page - 当前牌桌。
 * @param event - 不含账号、房间或业务正文的固定阶段名。
 */
export async function sampleCardSprites(page: Page, event: string): Promise<void> {
  if (!recordings.has(page)) return;
  await page.evaluate(event => {
    const state = window as typeof window & { __clrnSampleCardSprites?: (event: string) => Promise<void> };
    return state.__clrnSampleCardSprites?.(event);
  }, event);
}

/**
 * 标记图集原始硬断言失败，只用于失败后的时钟对照。
 * @param page - 当前牌桌。
 */
export function markCardSpriteFailure(page: Page): void {
  const recording = recordings.get(page);
  if (recording) recording.failed = true;
}

/**
 * 在原始失败截图保存后观察正常速度 JS 时钟；绝不重试原用例或进入基准比较。
 * @param page - 已经失败且即将清理的页面。
 */
export async function observeCardSpriteClockControl(page: Page): Promise<void> {
  if (!recordings.get(page)?.failed || hasNormalCardSpriteClock(page)) return;
  await sampleCardSprites(page, 'control-before-resume');
  await page.clock.resume();
  // 这些是诊断采样时刻，不是加长就绪等待；原始断言结果保持失败。
  const start = Date.now();
  for (const at of [0, 16, 80, 160, 320, 640, 1200]) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, start + at - Date.now())));
    await sampleCardSprites(page, 'control-running-' + at);
  }
}

/**
 * 保存运行身份和完整有界时间线，明确 DOM 解码不等于应用内部加载回调完成。
 * @param page - 尚未关闭的牌桌。
 * @param info - 当前用例及附件目录。
 * @param phase - frozen 单独保存原始失败（原生时间页明确标记），final 包含之后的对照观察。
 */
export async function saveCardSpriteDiagnostics(page: Page, info: TestInfo, phase: 'frozen' | 'final' = 'final'): Promise<void> {
  const recording = recordings.get(page);
  if (!recording) return;
  await sampleCardSprites(page, 'save');
  const applicationBuild = await page.locator('meta[name="build-version"]').getAttribute('content').catch(() => null);
  const lifecycle = await page.evaluate(() => {
    const state = window as typeof window & { __clrnCardSpriteLifecycle?: (node: Element) => unknown };
    return state.__clrnCardSpriteLifecycle?.(document.documentElement) ?? { status: 'not-enabled' };
  });
  const report = { applicationBuild: diagnosticText(applicationBuild), release: process.env.CLRN_RELEASE_TAG ?? null,
    clock: hasNormalCardSpriteClock(page) ? 'normal' : 'frozen',
    lifecycle,
    testCommit: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null,
    project: info.project.name, viewport: page.viewportSize(), repeat: info.repeatEachIndex, retry: info.retry,
    failed: recording.failed, dropped: recording.dropped, entries: recording.entries,
    limitations: 'realTime 是宿主收到事件的时间；decode 仅观察 DOM 图片，不代表应用内部 ImageLoader；'
      + 'React 取证仅观察受支持组件的提交状态，未拦截或调用内部 ImageLoader/onLoad；'
      + 'control-running 为原始失败后的同页 JS 时钟恢复观察，CSS 采样暂停保持原状；不能单独证明因果。' };
  const name = phase === 'frozen'
    ? (hasNormalCardSpriteClock(page) ? 'card-sprite-diagnostics-normal-failure' : 'card-sprite-diagnostics-frozen')
    : 'card-sprite-diagnostics';
  const path = info.outputPath(name + '.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}
