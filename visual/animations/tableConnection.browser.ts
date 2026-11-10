import { launchAnimationBrowser } from './appSessionBrowser';
/** 离线验证牌桌健康缓存过期后恢复及重试上限。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForTableConnection } from './tableSession';

const cases = ['common-alert-button-retry', 'alert-custom-button']
      .flatMap(/** 展开当前条目对应的`[false, true].map(persistent => ({ id, persistent }))`。
 * @param id - 当前操作使用的 id。 */ id => [false, true].map(/** 将当前条目映射为`{ id, persistent }`。
 * @param persistent - 当前操作使用的 persistent。 */ persistent => ({ id, persistent, label: 'Retry' })))
      .concat(['重试', '重試'].map(/** 覆盖简繁中文连接弹窗，确保不会误点退出按钮。
 * @param label - 应用重试按钮的本地化文案。 */ label => ({ id: 'alert-custom-button', persistent: false, label })));
for (const { id, persistent, label } of cases) {
  test(`连接按钮 ${id} ${label} persistent=${persistent} 恢复后才就绪，最多点击三次`, /** 验证恢复与持续失败的原始重试边界。 */ async () => {
    const browser = await launchAnimationBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`<div data-testid="common-alert-container">
        <span data-testid="common-alert-message">Connection Timeout</span>
        <button data-testid="alert-custom-button">Cancel</button>
        <button id="retry" data-testid="${id}">${label}</button></div><output data-probes="0">0</output>`);
      await page.evaluate(/** 绑定牌桌重试按钮，按场景控制提示持续存在或恢复就绪。
 * @param persistent - 当前操作使用的 persistent。 */ persistent => {
        let cachedUntil = Date.now() + 10_000;
        document.querySelector('#retry')!.addEventListener('click', /** 累计重试次数，非持续失败场景中移除提示并生成就绪入口。 */ () => {
          const output = document.querySelector('output')!;
          output.textContent = String(Number(output.textContent) + 1);
          // 与本轮 Release 一样，缓存未过期的点击不会重新探测或恢复连接。
          if (Date.now() < cachedUntil) return;
          output.dataset.probes = String(Number(output.dataset.probes) + 1);
          cachedUntil = Date.now() + 10_000;
          if (!persistent) {
            document.querySelector('div')!.remove();
            const ready = document.createElement('button');
            ready.dataset.testid = 'texas-holdem-start-room-timer-button';
            document.body.append(ready);
          }
        });
      }, persistent);
      const waiting = waitForTableConnection(page, 'texas', 'texas-holdem');
      if (persistent) await assert.rejects(waiting, /牌桌未就绪，应用提示/);
      else await waiting;
      const expected = persistent ? '3' : '1';
      assert.equal(await page.locator('output').textContent(), expected);
      assert.equal(await page.locator('output').getAttribute('data-probes'), expected);
    } finally { await browser.close(); }
  });
}
