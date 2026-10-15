import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { foregroundPanels, subtractPanel, visibleMasks, countdownMask } = require('./game-masks.ts');

test('公共牌倒计时从两位变一位时保持同一小块遮罩，不覆盖旁边说明', () => {
  const twoDigits = countdownMask({ x: 410, y: 314, width: 48, height: 56 }, '10');
  const oneDigit = countdownMask({ x: 422, y: 314, width: 24, height: 56 }, '9');
  assert.deepEqual(oneDigit, twoDigits);
  assert.deepEqual({ ...oneDigit, reason: undefined }, { x: 410, y: 314, width: 48, height: 56, reason: undefined });
  assert.throws(() => countdownMask({ x: 0, y: 0, width: 100, height: 56 }, 'Countdown'));
});

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

test('房间计时不能遮掉结算牌型和覆盖其上的牌桌按钮', () => {
  const source = { bounds: { x: 356, y: 718, width: 120, height: 30 } };
  const text = { res: 'showdown-assist-view-strength-text', text: '3 of Kind', bounds: { x: 245, y: 718, width: 146, height: 51 } };
  const banner = { res: 'showdown-assist-view-container', bounds: { x: 0, y: 706, width: 720, height: 75 }, children: [text] };
  assert.deepEqual(visibleMasks({ ...source.bounds, reason: '计时' }, source, foregroundPanels([banner, text])), []);
  const empty = { ...banner, children: [{ ...text, text: '', bounds: { ...text.bounds, width: 0 } }] };
  assert.deepEqual(foregroundPanels([empty]), []);
  for (const res of ['texas-holdem-show-remain-community-card-button', 'texas-holdem-shortcut-raise-button-two_thirds_pot', 'zhajinhua-shortcut-raise-second']) {
    const button = { res, bounds: { x: 248, y: 715, width: 224, height: 101 } };
    const masks = visibleMasks({ ...source.bounds, reason: '房号' }, source, foregroundPanels([button]));
    assert.equal(masks.some(mask => mask.x <= 400 && mask.x + mask.width > 400), false);
  }
});

test('网络延迟两位和三位数字引起横移时，遮罩固定且覆盖比例条，不覆盖上方操作控件', () => {
  const { networkStatusMask } = require('./game-masks.ts');
  const twoDigits = networkStatusMask({ x: 600, y: 66, width: 120, height: 140 });
  const threeDigits = networkStatusMask({ x: 595, y: 66, width: 125, height: 140 });
  assert.deepEqual(twoDigits, threeDigits);
  for (const content of [
    { x: 646, y: 150, width: 28, height: 2 },
    { x: 649, y: 156, width: 22, height: 17 },
    { x: 636, y: 172, width: 43, height: 20 },
  ]) assert.deepEqual(subtractPanel({ ...content, reason: '真实网络状态内容' }, twoDigits), []);
  assert.equal(twoDigits.y > 140, true);
  const button = { x: 620, y: 72, width: 60, height: 60, reason: '牌型按钮' };
  assert.deepEqual(subtractPanel(button, twoDigits), [button]);
});

test('拼三张圆形加注按钮的透明角落仍遮罩背景计时，圆形顶部和按钮文字保持比较', () => {
  const source = { res: 'countdown-text', bounds: { x: 345, y: 729, width: 120, height: 30 } };
  const button = { res: 'zhajinhua-shortcut-raise-third', bounds: { x: 385, y: 750, width: 86, height: 101 }, children: [
    { bounds: { x: 385, y: 750, width: 86, height: 83 } },
    { text: '160', bounds: { x: 385, y: 777, width: 86, height: 29 } },
    { text: 'Raise', bounds: { x: 398, y: 833, width: 59, height: 18 } },
  ] };
  const parts = visibleMasks({ ...source.bounds, reason: '真实倒计时' }, source, [button]);
  for (const [x, y, expected] of [[422, 750, true], [428, 750, true],
    [413, 751, true], [414, 751, true], [415, 751, true],
    [412, 752, true], [413, 752, true], [428, 752, false], [428, 780, false], [428, 840, false]]) {
    assert.equal(parts.some(part => x >= part.x && x < part.x + part.width && y >= part.y && y < part.y + part.height), expected);
  }
});
