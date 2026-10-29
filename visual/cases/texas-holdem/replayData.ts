/** 场景选择器与断言所用的虚拟玩家标识；响应消息由 Python 生成。 */
export const REPLAY_PLAYER_IDS = [1, 2, 3, 4].map(index =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type TableLayout = 'standard' | 'observer' | 'full' | 'full-pots' | 'check'
  | 'all-in-only' | 'all-in-call' | 'shortcut-blinds' | 'shortcut-disabled';

/**
 * 选择 Python 中的牌桌状态；不构造 WebSocket 消息。
 * @param self - 本轮账号，仅保留调用契约，Python 从真实订阅确认身份。
 * @param street - 牌局阶段。
 * @param opponentTurn - 是否轮到对手。
 * @param layout - 具名座位或操作按钮场景。
 */
export function restoreTable(self: string, street: Street, opponentTurn = false, layout: TableLayout = 'standard') {
  if (!self) throw new Error('回放必须绑定真实账号');
  return { scene: 'restore', parameters: { street, turn: opponentTurn ? 'opponent' : 'self', layout } };
}
