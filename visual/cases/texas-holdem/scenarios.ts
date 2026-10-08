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
];
