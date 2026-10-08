import type { SignedInPageDef } from '../../scenarioTypes';

/** 同一次真实建房进入牌桌后，依次采集所有无需开局的稳定界面。 */
export const PRE_GAME_STATES = [
  'waiting_table',
  'menu',
  'card_rank',
  'theme',
  'settings',
  'buy_in',
  'renew',
  'leaderboard',
  'game_record',
  'chat',
  'buy_in_applications',
] as const;

export const OPTIONAL_PRE_GAME_STATES = [
  'waiting_table',
  'raise_blinds',
] as const;

export const GAME_STATES = [
  'preflop', 'flop', 'turn', 'river', 'raise', 'accurate_raise',
  'opponent_turn', 'all_in', 'showdown', 'settlement',
  'own_profile', 'player_profile', 'player_statistics_1000', 'statistics_help', 'report', 'block',
] as const;

export const PANEL_STATES = [
  'theme_four_color', 'theme_four_color_two', 'theme_realistic',
  'table_blue', 'table_purple', 'table_black', 'settings_enabled', 'voice',
  'leaderboard_players', 'record_settlement', 'record_actions',
  'chat_phrases', 'chat_history', 'chat_actions', 'chat_report', 'chat_block_confirm',
  'buy_in_review', 'hand_end', 'remaining_cards', 'show_cards', 'quit_confirm',
] as const;

export const HALL_STATES = ['hall_table', 'hall_menu', 'auto_rebuy', 'pair_play_report',
  'personal_leaderboard', 'prediction', 'prediction_result', 'level_up'] as const;

const common: Omit<SignedInPageDef, 'label' | 'snapshotStates'> = {
  tabTestId: 'private-room-tab',
  visualReadySelector: '[data-testid="copy-house-number-button"]',
  fixedTexts: [
    { selector: '[data-testid="texas-holdem-room-id-text"]', text: '123456789' },
    { selector: '[data-testid="texas-holdem-room-name-text"]', text: 'TestRoom' },
    { selector: '[data-testid^="public-leader-board-item-nickname-"]', text: 'TestPlayer' },
    { selector: '[data-testid="public-leader-board-container"] > :last-child', text: '00000000-0000-0000-0000-000000000000' },
    { selector: '[data-testid="texas-holdem-nickname-text"]', text: 'TestPlayer' },
    // 固定文案用于稳定截图，不代表 mitmproxy 的真实延迟。
    { selector: '[data-testid="ping-screen-text"]', text: '0ms' },
    { selector: '[data-testid="renew-popup-remain-diamond"]', text: '60' },
  ],
};

export const pages: SignedInPageDef[] = [
  { ...common, label: 'signed_in_texas_pre_game', snapshotStates: [...PRE_GAME_STATES] },
  { ...common, label: 'signed_in_texas_optional_pre_game', snapshotStates: [...OPTIONAL_PRE_GAME_STATES] },
  { ...common, label: 'signed_in_texas_game', snapshotStates: [...GAME_STATES] },
  { ...common, label: 'signed_in_texas_panels', snapshotStates: [...PANEL_STATES] },
  { ...common, label: 'signed_in_texas_hall', snapshotStates: [...HALL_STATES] },
];
