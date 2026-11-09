/** 场景重构的入场响应隔离和失败清理顺序回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response } from '@playwright/test';
import { cleanupTexasScenario, matchesRecordEntry } from './scenarioLifecycle';
import { buildScenarios } from '../../scenarios';

const scenario = buildScenarios({ VISUAL_LOCALES: 'zh-Hans', VISUAL_SUITE: 'texas' })
  .find(/** 选择新版牌谱场景。
   * @param item - 当前场景。 */ item => item.pageLabel === 'signed_in_texas_records_v2')!;
const room = { roomId: '11111111-2222-4333-8444-555555555555', apiOrigin: 'https://example.invalid', authorization: 'test-only' };

for (const [label, activeRoom, method, path, expected] of [
  ['signed_in_texas_records_v2', room, 'PUT', `/v10/texas_holdem/room/${room.roomId}/enter`, true],
  ['signed_in_texas_records_v2', undefined, 'PUT', `/v10/texas_holdem/room/${room.roomId}/enter`, false],
  ['signed_in_texas_game', room, 'PUT', `/v10/texas_holdem/room/${room.roomId}/enter`, false],
  ['signed_in_texas_records_v2', room, 'GET', `/v10/texas_holdem/room/${room.roomId}/enter`, false],
  ['signed_in_texas_records_v2', room, 'PUT', '/v10/texas_holdem/room/another-room/enter', false],
] as const) {
  test(`入场响应只属于当前场景与房间：${label}/${method}/${path}/${Boolean(activeRoom)}`, /** 验证响应识别不跨房间。 */ () => {
    const response = {
      /** 读取本次响应的方法。 */
      request: () => ({ /** 返回预设方法。 */ method: () => method }),
      /** 返回实际响应地址。 */
      url: () => `https://api.example.invalid${path}`,
    } as unknown as Response;
    assert.equal(matchesRecordEntry({ ...scenario, pageLabel: label }, activeRoom, response), expected);
  });
}

for (const failure of ['none', 'room', 'proxy', 'context'] as const) {
  test(`清理顺序保留且错误继续传播：${failure}`, /** 所有失败路径都关闭上下文。 */ async () => {
    const order: string[] = [];
    const error = new Error(failure);
    const proxy = {
      /** 记录代理释放，按用例返回原始错误。 */
      async releaseTexas() {
        order.push('proxy');
        if (failure === 'proxy') throw error;
        return {} as Awaited<ReturnType<import('./proxy').TexasProxy['releaseTexas']>>;
      },
    };
    const context = {
      /** 记录最终上下文关闭。 */
      async close() { order.push('context'); if (failure === 'context') throw error; },
    };
    const activeRoom = failure === 'room' ? { ...room, roomId: '../another-room' } : undefined;
    const cleanup = cleanupTexasScenario(context, proxy, activeRoom);
    await assertCleanupResult(cleanup, failure, error);
    assert.deepEqual(order, ['proxy', 'context']);
  });
}

/**
 * 验证每种清理错误的传播对象和房间标识拒绝语义。
 * @param cleanup - 清理任务。
 * @param failure - 用例选择的失败阶段。
 * @param error - 原始代理或上下文错误。
 */
async function assertCleanupResult(cleanup: Promise<void>, failure: string, error: Error) {
  if (failure === 'none') return cleanup;
  if (failure === 'room') return assert.rejects(cleanup, /有效 UUID/);
  await assert.rejects(cleanup, error);
}
