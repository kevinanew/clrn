import { launchAnimationBrowser } from './appSessionBrowser';
/** 离线验证牌桌连接弹窗恢复及重试上限。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForTableConnection } from './tableSession';

const cases = ['common-alert-button-retry', 'alert-custom-button']
      .flatMap(/** 展开当前条目对应的`[false, true].map(persistent => ({ id, persistent }))`。
 * @param id - 当前操作使用的 id。 */ id => [false, true].map(/** 将当前条目映射为`{ id, persistent }`。
 * @param persistent - 当前操作使用的 persistent。 */ persistent => ({ id, persistent })));
for (const { id, persistent } of cases) {
  test(`连接按钮 ${id} persistent=${persistent} 恢复后才就绪，最多点击三次`, /** 验证恢复与持续失败的原始重试边界。 */ async () => {
    const browser = await launchAnimationBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`<div data-testid="common-alert-container">
        <span data-testid="common-alert-message">timeout of 10000ms exceeded</span>
        <button data-testid="alert-custom-button">Cancel</button>
        <button id="retry" data-testid="${id}">Retry</button></div><output>0</output>`);
      await page.evaluate(/** 绑定牌桌重试按钮，按场景控制提示持续存在或恢复就绪。
 * @param persistent - 当前操作使用的 persistent。 */ persistent => {
        document.querySelector('#retry')!.addEventListener('click', /** 累计重试次数，非持续失败场景中移除提示并生成就绪入口。 */ () => {
          const output = document.querySelector('output')!;
          output.textContent = String(Number(output.textContent) + 1);
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
      assert.equal(await page.locator('output').textContent(), persistent ? '3' : '1');
    } finally { await browser.close(); }
  });
}
