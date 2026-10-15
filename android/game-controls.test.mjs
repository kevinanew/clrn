import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { flattenNodes, gameNodes, gameSemanticText } = require('./game-controls.ts');

test('原生控件树保留重复 ID，忽略屏外历史面板但不忽略可见子节点', () => {
  const root = { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [
    { res: 'seat', bounds: { x: 10, y: 20, width: 40, height: 40 } },
    { res: 'seat', bounds: { x: 110, y: 20, width: 40, height: 40 } },
    { res: 'old-popup', bounds: { x: 0, y: 1300, width: 720, height: -20 } },
    { res: 'flattened-parent', bounds: { x: 0, y: 0, width: 0, height: 0 }, children: [
      { res: 'visible-child', bounds: { x: 20, y: 20, width: 40, height: 40 } },
    ] },
  ] };
  assert.deepEqual(flattenNodes(root).map(node => node.res), [undefined, 'seat', 'seat', 'visible-child']);
});

test('摊牌余额读取当前玩家的嵌套语义标记，不依赖被牌型覆盖的可见文字', () => {
  const own = { res: 'self', bounds: { x: 200, y: 1000, width: 100, height: 180 }, children: [
    { bounds: { x: 200, y: 1150, width: 100, height: 30 }, children: [
      { res: 'player_stack_text', text: 'self 1120', bounds: { x: 200, y: 1150, width: -1, height: 0 } },
    ] },
  ] };
  assert.equal(flattenNodes(own).some(node => node.res === 'player_stack_text'), false);
  assert.equal(gameSemanticText(own, 'player_stack_text'), 'self 1120');
  assert.equal(gameSemanticText(own, 'missing-marker'), undefined);
  assert.equal(gameSemanticText(undefined, 'player_stack_text'), undefined);
});

test('控件树驱动协议变更和断连必须失败，不能当作空页面', async () => {
  for (const result of [{}, { bounds: {} }]) {
    await assert.rejects(gameNodes({ _connection: {
      /** 模拟固定版本驱动的不完整响应。 */
      toImpl: () => ({ /** 返回损坏的控件树。 */ _send: async () => result }),
    } }), /完整控件树/);
  }
  await assert.rejects(gameNodes({ _connection: {
    /** 模拟原生连接失败。 */
    toImpl: () => ({ /** 传播断连异常。 */ _send: async () => { throw new Error('Device closed'); } }),
  } }), /Device closed/);
});
