// 与 Web 同名的原生状态；加载、侧滑删除和故障恢复状态须单独适配，不能计入已覆盖数量。
export const recordStates = ['empty', 'list', 'list_bottom', 'select_none', 'select_win', 'select_loss',
  'select_all', 'select_clear', 'select_cancel', 'private_overview', 'private_actions', 'private_settlement',
  'replay_list', 'club_overview', 'club_actions', 'club_settlement', 'hall_overview', 'short_deck_overview',
  'no_hands', 'replay_empty'] as const;
