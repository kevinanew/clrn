/** 拼三张场景选择器与断言使用的虚拟玩家标识。 */
export const PLAYER_IDS = [1, 2, 3, 4].map(index =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
/**
 * 选择 Python 中的拼三张牌桌状态。
 * @param self - 本轮账号，由代理从真实订阅再次确认。
 * @param opponent - 是否轮到对手。
 * @param seen - 是否已看牌。
 */
export function restoreTable(self: string, opponent = false, seen = false) {
  if (!self) throw new Error('回放必须绑定真实账号');
  return { scene: 'restore', parameters: { turn: opponent ? 'opponent' : 'self', cards: seen ? 'seen' : 'blind' } };
}
