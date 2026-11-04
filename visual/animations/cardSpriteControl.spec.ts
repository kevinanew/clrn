/** 独立新页面完整重放原玩法至摊牌；交替时钟和观察器开关，不替代普通动画比较。 */
import { test, expect } from '../cases/texas-holdem/proxy';
import { withTable } from './tableSession';
import { texasGameplay } from './texasGameplay';
import { captureTimeline } from './timeline';
import { sampleCardSprites } from './cardSpriteDiagnostics';

/**
 * 沿用原采样时刻和业务／运动断言，只将独立对照的画面保存为证据。
 * @param page - 本轮独占的正常或冻结时间页面。
 * @param info - 独立报告，不生成或比较基准。
 * @param name - 原流程中的动画阶段名。
 * @param target - 原动画主体。
 * @param options - 原采样时间、资源就绪及运动要求。
 */
async function observeTimeline(page: Parameters<typeof captureTimeline>[0], info: Parameters<typeof captureTimeline>[1],
  name: string, target: Parameters<typeof captureTimeline>[3], options: Parameters<typeof captureTimeline>[4] = {}) {
  await sampleCardSprites(page, 'history-' + name);
  await captureTimeline(page, info, name, target, { ...options, observeFrames: true });
}

// 观察器开关独立成例，以新 context/page/真实房间避免回调包装和 React hook 相互污染。
for (const callbacks of [false, true]) {
  for (const position of [0, 1]) {
    test(`independent card sprite clock ${position} callbacks ${callbacks}`, /** 按牌面位置与回调开关验证独立牌面时钟的准备和动画行为。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ browser, mitmproxy }, info) => {
      test.setTimeout(1_200_000);
      expect(info.config.updateSnapshots, '独立取证禁止生成基准').toBe('none');
      expect(process.env.CLRN_EXPECTED_APPLICATION_COMMIT, '必须重放 #68 的原固定应用提交')
        .toBe('69f9251d3b5f2b93aa2d880d27abbeefe16ee645');
      expect(process.env.CLRN_RELEASE_WEB_ROOT, '必须使用校验过摘要的固定 Release').toBeTruthy();
      const clock = (position + info.repeatEachIndex) % 2 === 0 ? 'frozen' : 'normal';
      await info.attach('independent-clock', { body: JSON.stringify({ clock, callbacks, history: 'texas-gameplay-through-showdown' }),
        contentType: 'application/json' });
      try {
        await withTable(browser, info, 'texas', mitmproxy, /** 在独立牌面时钟下完成德州摊牌，并按场景核验组件生命周期回调。
 * @param session - 当前操作使用的 session。 */ async session => {
          await texasGameplay(session, mitmproxy, info, { capture: observeTimeline });
          await sampleCardSprites(session.page, 'independent-showdown-ready');
          if (callbacks) {
            const lifecycle = await session.page.getByTestId('sprite-image-container').first().evaluate(/** 读取首个牌面精灵的组件提交与生命周期观测结果。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
              const state = window as typeof window & { __clrnCardSpriteLifecycle: (node: Element) => {
                status: string; commits: number; truncated: boolean; component: { supported: boolean } | null;
              } };
              return state.__clrnCardSpriteLifecycle(node);
            });
            expect(lifecycle.status, '不支持的 React 提交观察必须明确保留未通过').toBe('renderer-observed');
            expect(lifecycle.commits).toBeGreaterThan(0);
            expect(lifecycle.truncated).toBe(false);
            expect(lifecycle.component?.supported, '不得将未知结构解释为组件状态').toBe(true);
          }
          await info.attach('independent-showdown', {
            body: await session.page.screenshot({ animations: 'allow', clip: session.clip }), contentType: 'image/png',
          });
        }, false, clock, callbacks ? 'callbacks' : false);
      } finally { await mitmproxy.releaseTexas(); }
    });
  }
}
