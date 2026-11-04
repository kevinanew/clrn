/** Sanitized native wire evidence; credentials and request headers are never persisted. */
export type WalletTransaction = { player: string; memo: string; amount: number; event: string };
export type WalletHit = { player: string; mode?: string; transaction: string; amount: number; at: number };
export type WalletState = {
  balances: Record<string, Record<string, number>>;
  transactions: Record<string, WalletTransaction>;
  hits: WalletHit[];
  fault: { mode: string; players: string[]; roomId: string | null };
};
export type NativeGamePublication = {
  stream: string;
  sent_at: string;
  queue: { event: string; player_id?: string; delay_seconds?: number; [key: string]: unknown }[];
};
export type RoomSnapshot = {
  player_pool: { players: Record<string, {
    stack: number; buy_in_amount: number; pay_amount: number; is_stand_up: boolean; is_quit: boolean;
  }> };
  pot: { players: string[] };
  room: { is_close: boolean };
};
export type NativeStatus = {
  owners: number;
  rooms: string[];
  connections: { user: string; subscriptions: string[] }[];
  records: { event: string; publication?: { data: NativeGamePublication }; [key: string]: unknown }[];
};
export type NativeReport = {
  scope: string;
  outcome: string;
  steps: { event: string; actor: number; user?: string }[];
  failure?: string;
  ledger?: WalletState;
  faultNotices: string[];
  correctness?: { originalWalletReasonReachesBrowser: boolean };
  [key: string]: unknown;
};
