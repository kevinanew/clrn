/** 离线验证冻结时钟下的连接重试、回复交接及首帧，另检查 RPC 回复的连接归属。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { chromium, type Page } from '@playwright/test';
import { observeSlotSpinReplies, waitForDeferredSlotRequest } from './slotSpin';

test('延迟请求只点击一次，回复前不启动动画，回复后保留完整时间轴', async () => {
  const browser = await chromium.launch();
  try {
    for (const delay of [0, 16, 1000, 2200]) {
      const page = await browser.newPage();
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      await page.setContent(`<button>SPIN</button><div id="reel"></div><script>
        window.spinState = { spins: 0, held: 0, clicks: 0, frames: 0 };
        document.querySelector('button').onclick = () => {
          spinState.clicks++;
          setTimeout(() => { spinState.spins++; spinState.held++; }, ${delay});
        };
        window.release = () => {
          const start = Date.now();
          const frame = () => {
            spinState.frames++;
            document.querySelector('#reel').textContent = String(Math.min(1000, Date.now() - start));
            if (Date.now() - start < 1000) requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        };
      </script>`);
      await page.getByRole('button').click({ force: true });
      await page.clock.runFor(0);
      if (delay) assert.equal(await page.evaluate('spinState.spins'), 0, '旧的零推进轮询无法发出延迟请求');
      await waitForDeferredSlotRequest(page, () => page.evaluate('spinState'), 1);
      assert.deepEqual(await page.evaluate('spinState'), { spins: 1, held: 1, clicks: 1, frames: 0 });
      assert.equal((await page.evaluate<number>('Date.now()')) % 16, 0, '回复交接必须对齐 RAF 相位');
      await page.evaluate('release()');
      await page.clock.runFor(16);
      assert.equal(await page.locator('#reel').textContent(), '16', '首帧不能因重试时长而跳过');
      await page.clock.runFor(160);
      assert.equal(await page.locator('#reel').textContent(), '176');
      await page.clock.runFor(1000);
      assert.equal(await page.locator('#reel').textContent(), '1000', '动画必须完整结束');
      await page.close();
    }
  } finally { await browser.close(); }
});

test('旋转回复按连接和请求编号匹配，不把心跳、能量读取和无关帧当成完成', () => {
  const page = new EventEmitter();
  const replies = observeSlotSpinReplies(page as unknown as Page);
  const sockets = [new EventEmitter(), new EventEmitter()];
  for (const socket of sockets) page.emit('websocket', socket);
  sockets[0].emit('framesent', { payload: 'invalid\nnull\n' + JSON.stringify({ id: 1, method: 9,
    params: { data: { path: '/v2/slot_machine/user/test/spin' } } }) });
  sockets[1].emit('framereceived', { payload: '{"id":1,"result":{}}' });
  sockets[0].emit('framereceived', { payload: '{"id":7,"result":{}}' });
  assert.equal(replies.received(), 0);
  sockets[0].emit('framereceived', { payload: '{"id":1,"result":{}}\n{"id":1,"result":{}}' });
  assert.equal(replies.received(), 1, '同一请求最多完成一次');
  sockets[0].emit('framesent', { payload: '{"id":2,"method":7}\n' + JSON.stringify({ id: 3, method: 9,
    params: { data: { path: '/v2/slot_machine/user/test/energy' } } }) });
  sockets[0].emit('framereceived', { payload: '{"id":2,"result":{}}\n{"id":3,"result":{}}' });
  assert.equal(replies.received(), 1);
});
