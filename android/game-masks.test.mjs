import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { foregroundPanels, subtractPanel, visibleMasks } = require('./game-masks.ts');

test('前景只裁掉相交区域，跨越面板边缘的背景箭头仍需遮罩', () => {
  const mask = { x: 0, y: 0, width: 20, height: 20, reason: '座位动画' };
  const parts = subtractPanel(mask, { x: 5, y: 5, width: 10, height: 10 });
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const covered = parts.some(part => x >= part.x && x < part.x + part.width
      && y >= part.y && y < part.y + part.height);
    assert.equal(covered, !(x >= 5 && x < 15 && y >= 5 && y < 15));
  }
  assert.deepEqual(subtractPanel(mask, mask), []);
  assert.deepEqual(subtractPanel(mask, { x: 20, y: 0, width: 10, height: 10 }), [mask]);
});

test('区分背景动画和前景房号，不能把整张屏幕或前景文字遮掉', () => {
  const source = { res: 'public-leader-board-container', bounds: { x: 30, y: 30, width: 20, height: 20 } };
  const panel = { bounds: { x: 20, y: 20, width: 400, height: 600 }, children: [source] };
  const touch = { res: 'screen-mask-touch-to-close', bounds: { x: 0, y: 0, width: 720, height: 1280 } };
  const parent = { bounds: touch.bounds, children: [touch, panel] };
  const panels = foregroundPanels([parent, touch, panel, source]);
  assert.deepEqual(panels, [panel]);
  const mask = { ...source.bounds, reason: '动态房号' };
  assert.deepEqual(visibleMasks(mask, source, panels), [mask]);
  assert.deepEqual(visibleMasks(mask, { bounds: source.bounds }, panels), []);
});

test('Fabric 压平后的全屏兄弟节点不能误认为不透明面板', () => {
  const marker = { res: 'drawer-menu-item-exit', bounds: { x: 0, y: 700, width: 328, height: 80 } };
  const panel = { bounds: { x: 0, y: 0, width: 328, height: 800 }, children: [marker] };
  const full = { x: 0, y: 0, width: 720, height: 1280 };
  const background = { res: 'table-background', bounds: full };
  const touch = { res: 'screen-mask-touch-to-close', bounds: full };
  const root = { bounds: full, children: [background, touch, panel] };
  assert.deepEqual(foregroundPanels([root, background, touch, panel, marker]), [panel]);
});

test('两种玩法摊牌后的牌面必须参与比较，不能被下面的头像倒计时遮罩盖住', () => {
  for (const res of ['player_cards_container', 'texas-holdem-player-hole-cards']) {
    const bounds = { x: 31, y: 696, width: 100, height: 100 };
    const countdown = { res: 'zhajinhua-active-countdown', bounds };
    const cards = { res, bounds };
    const panels = foregroundPanels([countdown, cards]);
    assert.deepEqual(panels, [cards]);
    const masks = visibleMasks({ x: 29, y: 694, width: 104, height: 104, reason: '倒计时' }, countdown, panels);
    assert.equal(masks.some(mask => 80 >= mask.x && 80 < mask.x + mask.width
      && 740 >= mask.y && 740 < mask.y + mask.height), false);
    assert.equal(masks.reduce((sum, mask) => sum + mask.width * mask.height, 0), 104 ** 2 - 98 ** 2);
  }
});

test('倒计时上方的小尺寸看牌和下注动作提示仍完整参与像素比较', () => {
  const countdown = { res: 'zhajinhua-active-countdown', bounds: { x: 100, y: 100, width: 100, height: 100 } };
  const bounds = { x: 100, y: 110, width: 39, height: 46 };
  const action = { bounds, children: [{ res: 'player_action_text', text: 'Seen', bounds }] };
  const panels = foregroundPanels([countdown, action, ...action.children]);
  assert.deepEqual(panels, [action]);
  const masks = visibleMasks({ ...countdown.bounds, reason: '倒计时' }, countdown, panels);
  assert.equal(masks.some(mask => 120 >= mask.x && 120 < mask.x + mask.width
    && 130 >= mask.y && 130 < mask.y + mask.height), false);
});
