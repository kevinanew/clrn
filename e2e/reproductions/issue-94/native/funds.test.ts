/** Regression for settlement-phase accounting and genuine committed-loss detection. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeFunds } from './funds.mjs';
import type { RoomSnapshot, WalletState } from './types';

/**
 * Make a minimal engine snapshot with historical contribution fields retained after settlement.
 * @param ended - Actual game settlement flag.
 */
function snapshot(ended: boolean): RoomSnapshot {
 return {game:{is_end:ended},room:{is_close:false},pot:{players:['a','b']},player_pool:{players:{
  a:{stack:100,buy_in_amount:0,pay_amount:200,is_stand_up:false,is_quit:false},
  b:{stack:400,buy_in_amount:0,pay_amount:200,is_stand_up:false,is_quit:false},
 }}};
}
/**
 * Supply isolated wallet balances without unrelated wire fixtures.
 * @param amounts - Owned balances and optional explicit reserve balances.
 */
function ledger(amounts: Record<string, number>): WalletState {
 return {balances:Object.fromEntries(Object.entries(amounts).map(([user,coin])=>[user,{coin}])),transactions:{},hits:[],fault:{mode:'normal',players:[],roomId:null}};
}

test('settled historical pay amounts are already included in awarded stacks',()=>{
 const result=nativeFunds(snapshot(true),ledger({a:9800,b:9700}));
 assert.equal(result.potCoin,0);assert.equal(result.total,20000);assert.equal(result.conserved,true);
});
test('live pot contributions remain part of conserved funds before settlement',()=>{
 const room=snapshot(false);room.player_pool.players.a.stack=98;room.player_pool.players.b.stack=0;
 room.player_pool.players.a.pay_amount=2;
 const result=nativeFunds(room,ledger({a:9900,b:9800}));
 assert.equal(result.potCoin,202);assert.equal(result.total,20000);
});
test('settlement accounting still rejects committed deductions without corresponding chips',()=>{
 const result=nativeFunds(snapshot(true),ledger({a:9700,b:9600}));
 assert.equal(result.total,19800);assert.equal(result.conserved,false);
});
test('explicit setup reserves count while historical stand-up stacks do not',()=>{
 const room=snapshot(true);room.player_pool.players.a.is_stand_up=true;
 const result=nativeFunds(room,ledger({a:50,b:50,'issue94-reserve:a':9750,'issue94-reserve:b':9750}));
 assert.equal(result.tableCoin,400);assert.equal(result.walletCoin,19600);assert.equal(result.conserved,true);
});
