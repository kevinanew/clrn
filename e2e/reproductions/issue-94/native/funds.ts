/** Account for real owned funds without counting already-awarded historical pot contributions. */
import type { RoomSnapshot, WalletState } from './types';

/**
 * Count live table chips, unsettled contributions and all isolated wallets, including reserves.
 * @param room - Actual persisted engine state at the observation.
 * @param ledger - Actual isolated wallet ledger, including explicit setup reserves.
 */
export function nativeFunds(room: RoomSnapshot, ledger: WalletState) {
 const players=room.player_pool.players;
 const walletCoin=Object.values(ledger.balances).reduce((sum,wallet)=>sum+wallet.coin,0);
 const tableCoin=Object.values(players).filter(player=>!player.is_stand_up&&!player.is_quit)
  .reduce((sum,player)=>sum+player.stack+player.buy_in_amount,0);
 const potCoin=room.game.is_end?0:room.pot.players.reduce((sum,user)=>sum+players[user].pay_amount,0);
 const total=walletCoin+tableCoin+potCoin;
 return {walletCoin,tableCoin,potCoin,total,expected:20000,conserved:total===20000};
}
