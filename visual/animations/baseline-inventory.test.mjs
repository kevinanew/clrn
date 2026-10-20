import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('全部已迁移的英文动画帧必须存在，禁止保留旧中文动画基准', () => {
  const expected = JSON.parse(readFileSync(new URL('./baseline-inventory.json', import.meta.url), 'utf8'));
  const actual = readdirSync(new URL('./snapshots/', import.meta.url))
    .filter(name => name.endsWith('.png') && !name.startsWith('asset-')).sort();
  assert.ok(expected.length > 0, '动画基准清单不得为空');
  assert.equal(new Set(expected).size, expected.length, '动画基准清单不得重复');
  assert.ok(expected.every(name => /^en-(mobile|desktop)-.+-\d+ms\.png$/.test(name)),
    '动画基准清单只接受英文关键帧');
  assert.deepEqual(actual, expected,
    '动画基准缺失或混入未登记/非英文截图；新增动画须同步审查清单');
});
