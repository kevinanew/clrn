import type { Page } from '@playwright/test';

/**
 * 仅替换当前页面的老虎机 RPC，混合批次内其他 RPC、订阅和心跳仍透传。
 * @param page - 尚未导航的浏览器页面。
 */
export async function mockSlotMessages(page: Page) {
  let currency = 'coin';
  let spins = 0;
  let userId = '';
  let noEnergy = false;
  const observed: string[] = [];
  await page.route(/\/v10\/wallet\/[^/?]+$/, route => route.request().method() === 'PUT'
    ? route.fulfill({ json: { ok: true, result: { currencies: [
      { code: 'coin', name: '金币', balance: '10000' },
      { code: 'diamond', name: '钻石', balance: '60' },
    ] } } }) : route.fallback());
  const energy = { user_energy: { total_energy: 0 },
    energy_factory: { capacity: 50, quantity: 50, remaining_production_time: '00:00:00' } };
  await page.routeWebSocket('**/*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const forward: string[] = [];
      for (const line of message.toString().split('\n').filter(Boolean)) {
        let frame;
        try { frame = JSON.parse(line); } catch { forward.push(line); continue; }
        const data = frame?.params?.data;
        if (typeof data?.path === 'string' && data.path.includes('slot_machine')) {
          observed.push(`${frame.method}:${data.path.replace(/user\/[^/]+/, 'user/current')}`);
        }
        if (data?.path?.match(/^\/v2\/slot_machine\/user\/[^/]+\/spin$/) && (!userId || !data.path.includes(`/${userId}/`))) {
          throw new Error('老虎机旋转必须先绑定本轮账号，拒绝向真实后端发送');
        }
        const base = `/v2/slot_machine/user/${userId}/`;
        if (!userId || frame.method !== 9 || !['energy', 'spin'].some(action => data?.path === base + action)) {
          forward.push(line);
          continue;
        }
        const spin = data.path.endsWith('/spin');
        if (spin) spins++;
        if (spin && noEnergy) {
          socket.send(JSON.stringify({ id: frame.id, result: { data: {
            ok: false, error: 'energy_not_enough', error_description: 'No energy',
          } } }));
          continue;
        }
        const result = spin ? { ...energy, outcome: [currency, currency, currency], reward: {
          outcome_pattern: 'three', prize: { coin: currency === 'coin' ? 100 : 0,
            diamond: currency === 'currency_diamond' ? 5 : 0, energy: currency === 'energy' ? 10 : 0 },
        } } : energy;
        socket.send(JSON.stringify({ id: frame.id, result: { data: { ok: true, result } } }));
      }
      if (forward.length) server.send(forward.join('\n'));
    });
  });
  return {
    /**
     * 绑定真实登录用户，使夹具只处理本轮账号。
     * @param id - 当前账号标识。
     */
    bindUser(id: string) { userId = id; },
    /**
     * 选择下一次旋转的确定奖励。
     * @param value - 真实老虎机图标名称。
     */
    reward(value: 'coin' | 'currency_diamond' | 'energy') { currency = value; },
    /** 后续旋转返回真实协议的能量不足错误。 */
    exhaustEnergy() { noEnergy = true; },
    /** 返回不含凭据和用户标识的老虎机协议记录。 */
    get observed() { return observed; },
    /** 返回实际隔离的旋转请求数。 */
    get spins() { return spins; },
  };
}
