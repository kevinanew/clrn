import { expect, test } from '@playwright/test';
import { captureTimeline, freeze, settleAnimations } from './timeline';
import { exercisePopup } from './popups';
import { slotWalletMask } from './slotWallet';

// 仅由 walletMask.browser.ts 在临时基准目录运行，不访问业务网络。
const comparison = process.env.WALLET_MASK_COMPARISON === 'true';
for (const change of ['balance', 'layout', 'animation', 'missing', 'data'] as const) {
  test(`wallet mask ${change}`, async ({ page }, info) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.setContent(`<style>
      body { margin:0; background:#ddd; }
      #panel { position:absolute; top:150px; left:10px; width:350px; height:500px; background:#8544ef; }
      #panel.enter { animation:enter ${comparison && change === 'animation' ? 640 : 320}ms linear both; }
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
    await page.evaluate(({ comparison, change }) => {
      const panel = document.getElementById('panel')!;
      if (comparison && change === 'layout') panel.style.left = '45px';
      if (comparison && change === 'missing') document.querySelector('.number')!.remove();
      let reads = 0;
      document.getElementById('open')!.onclick = /** 开始一轮面板和余额动画。 */ () => {
        panel.style.display = 'block';
        panel.className = 'enter';
        const numbers = document.querySelectorAll('.number');
        numbers.forEach((number, index) => { number.textContent = comparison ? ['9,999,999', '1'][index] : '0'; });
        // 在每一帧中更新不同位数，不能只靠末帧遮罩通过。
        const timer = setInterval(() => {
          numbers.forEach((number, index) => { number.textContent = comparison
            ? [reads++ % 2 ? '9,999,999' : '7', '1'][index] : '0'; });
        }, 16);
        setTimeout(() => { clearInterval(timer); numbers.forEach(number => { number.textContent = comparison ? '123' : '0'; }); }, 1000);
      };
      document.getElementById('close')!.onclick = /** 触发退出动画并在终态隐藏。 */ () => {
        panel.className = 'exit';
        setTimeout(() => { panel.style.display = 'none'; }, 160);
      };
    }, { comparison, change });
    const panel = page.getByTestId('slot-machine-view');
    const numericMask = slotWalletMask(panel);
    const clip = { x: 0, y: 0, ...page.viewportSize()! };
    await exercisePopup(page, info, { name: `wallet-${change}`, target: panel, clip, numericMask,
      open: /** 通过夹具的按钮触发 CSS 入场。 */ () => page.locator('#open').dispatchEvent('click'),
      close: /** 通过夹具的按钮触发 CSS 退场。 */ () => page.locator('#close').dispatchEvent('click'),
      afterEntrance: /** 数字仍须显示真实状态，遮罩不能让数据断言失效。 */ async () => {
        await expect(panel.locator('.number')).toHaveText(
          comparison && change === 'data' ? ['999', '999'] : comparison ? ['123', '123'] : ['0', '0'], { timeout: 100 });
      } });
    await page.locator('#open').dispatchEvent('click');
    await settleAnimations(page, 1600);
    await freeze(page);
    await page.evaluate(() => {
      let position = 40;
      setInterval(() => { document.getElementById('reel')!.style.left = `${position += 1}px`; }, 16);
    });
    await captureTimeline(page, info, `wallet-${change}-reward`, panel.locator('#reel'),
      { clip, numericMask, requireMotion: true, times: [0, 160, 500, 1000] });
    await info.attach('wallet-complete', { body: 'enter/exit/reward', contentType: 'text/plain' });
  });
}
