import { expect, test } from '../src/support/diagnosticTest';
import { captureTimeline, freeze, settleAnimations } from './timeline';
import { exercisePopup } from './popups';
import { slotWalletMask } from './slotWallet';

// 仅由 walletMask.browser.ts 在临时基准目录运行，不访问业务网络。
const comparison = process.env.WALLET_MASK_COMPARISON === 'true';
for (const change of ['balance', 'layout', 'animation', 'missing', 'data'] as const) {
  test(`wallet mask ${change}`, /** 按当前数字、布局或可见性变化验证钱包遮罩的比较边界。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ page }, info) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.setContent(`<style>
      body { margin:0; background:#ddd; }
      #panel { position:absolute; top:150px; left:10px; width:350px; height:500px; background:#8544ef; }
      #panel.enter { animation:enter ${entranceDuration(change)}ms linear both; }
      #panel.exit { animation:exit 160ms linear both; }
      @keyframes enter { from { transform:translateY(1000px); opacity:0; } to { transform:translateY(0); opacity:1; } }
      @keyframes exit { from { transform:translateY(0); opacity:1; } to { transform:translateY(1000px); opacity:0; } }
      #toolbar { display:flex; height:40px; align-items:center; }
      .bar { position:relative; width:150px; height:30px; margin:5px; border-radius:15px; background:#582ea6; }
      .icon { position:absolute; top:0; left:0; width:30px; height:30px; background:gold; border-radius:50%; }
      .number { position:absolute; left:35px; width:110px; height:19px; top:5px;
        text-align:center; font:bold 16px sans-serif; color:gold; text-shadow:2px 2px 5px black; }
      #diamond { width:115px; } #diamond .number { width:75px; } #diamond .icon { background:cyan; }
      #reel { position:absolute; left:40px; top:70px; width:260px; height:250px; background:#24e; }
      #energy { position:absolute; top:340px; width:300px; height:25px; background:white; }
    </style><div id="panel" data-testid="slot-machine-view">
      <div id="toolbar" data-testid="top-toolbar">
        <div class="bar"><div class="icon"></div><div class="number">0</div></div>
        <div class="bar" id="diamond"><div class="icon"></div><div class="number">0</div></div>
      </div><div id="reel"></div><div id="energy">50 / 50</div>
    </div><button id="open">Open</button><button id="close">Close</button>`);
    await page.evaluate(/** 按回归场景改变钱包布局、数字和可见性，测试遮罩的边界。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ comparison, change }) => {
      const panel = document.getElementById('panel')!;
      if (comparison) applyChange();
      /** 仅在比较轮注入指定的布局或节点故障。 */
      function applyChange() {
        if (change === 'layout') panel.style.left = '45px';
        if (change === 'missing') document.querySelector('.number')!.remove();
      }
      let reads = 0;
      document.getElementById('open')!.onclick = /** 开始一轮面板和余额动画。 */ () => {
        panel.style.display = 'block';
        panel.className = 'enter';
        const numbers = document.querySelectorAll('.number');
        numbers.forEach(/** 设置基准或对照余额文本，制造数字长度差异。
 * @param number - 当前操作使用的 number。
 * @param index - 当前条目在集合中的位置。 */ (number, index) => { number.textContent = comparison ? ['9,999,999', '1'][index] : '0'; });
        // 在每一帧中更新不同位数，不能只靠末帧遮罩通过。
        const timer = setInterval(/** 周期更新钱包数字，验证动态余额不会阻塞非数字画面稳定。 */ () => {
          numbers.forEach(/** 按当前周期和索引写入变化中的余额数字。
 * @param number - 当前操作使用的 number。
 * @param index - 当前条目在集合中的位置。 */ (number, index) => { number.textContent = comparison
            ? [reads++ % 2 ? '9,999,999' : '7', '1'][index] : '0'; });
        }, 16);
        setTimeout(/** 停止余额变化并写入最终数字，验证稳定检测可结束。 */ () => { clearInterval(timer); numbers.forEach(/** 为当前数字节点设置场景要求的最终文本。
 * @param number - 当前操作使用的 number。 */ number => { number.textContent = comparison ? '123' : '0'; }); }, 1000);
      };
      document.getElementById('close')!.onclick = /** 触发退出动画并在终态隐藏。 */ () => {
        panel.className = 'exit';
        setTimeout(/** 延迟隐藏钱包面板，验证遮罩不会掩盖元素消失。 */ () => { panel.style.display = 'none'; }, 160);
      };
    }, { comparison, change });
    const panel = page.getByTestId('slot-machine-view');
    const numericMask = process.env.WALLET_MASK_UNMASKED === 'true' ? undefined : slotWalletMask(panel);
    const clip = { x: 0, y: 0, ...page.viewportSize()! };
    await exercisePopup(page, info, { name: `wallet-${change}`, target: panel, clip, numericMask,
      open: /** 通过夹具的按钮触发 CSS 入场。 */ () => page.locator('#open').dispatchEvent('click'),
      close: /** 通过夹具的按钮触发 CSS 退场。 */ () => page.locator('#close').dispatchEvent('click'),
      afterEntrance: /** 数字仍须显示真实状态，遮罩不能让数据断言失效。 */ async () => {
        await expect(panel.locator('.number')).toHaveText(
          expectedBalances(change), { timeout: 100 });
      } });
    await page.locator('#open').dispatchEvent('click');
    await settleAnimations(page, 1600);
    await freeze(page);
    await page.evaluate(/** 安装持续移动的滚轮，验证数字遮罩不能隐藏非数字动画。 */ () => {
      let position = 40;
      setInterval(/** 每帧移动滚轮，维持可观测的非数字画面变化。 */ () => { document.getElementById('reel')!.style.left = `${position += 1}px`; }, 16);
    });
    await captureTimeline(page, info, `wallet-${change}-reward`, panel.locator('#reel'),
      { clip, numericMask, requireMotion: true, times: [0, 160, 500, 1000] });
    await info.attach('wallet-complete', { body: 'enter/exit/reward', contentType: 'text/plain' });
  });
}

/**
 * 只在动画故障比较轮延长原入场时长。
 * @param change - 本轮故障场景。
 */
function entranceDuration(change: string) { return comparison && change === 'animation' ? 640 : 320; }

/**
 * 真实数据断言独立于数字遮罩，错误数据仍立即失败。
 * @param change - 本轮故障场景。
 */
function expectedBalances(change: string) {
  if (!comparison) return ['0', '0'];
  return change === 'data' ? ['999', '999'] : ['123', '123'];
}
