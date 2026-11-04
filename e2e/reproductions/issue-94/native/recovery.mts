/** Observe the actual wallet fault before exercising visible recovery controls. */
import { expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { Mitmproxy } from '../../../helpers/mitmproxy-client';
import type { NativeStatus, NativeReport, WalletState, WalletHit, RoomSnapshot, NativeRecord } from './types';

/** Services already owned and authenticated by the native runner. */
export type RecoveryTools = {
 report: NativeReport;
 evidence: string;
 walletControl: <T = unknown>(endpoint: string, body?: Record<string, unknown>) => Promise<T>;
 roomSnapshot: (room: string) => RoomSnapshot;
 verifyFunds: (room: RoomSnapshot, ledger: WalletState) => { total: number; expected: number; conserved: boolean };
 screenshotAfterSettling: (page: Page, path: string) => Promise<void>;
 waitPublishedOutcome: (proxy: Mitmproxy, hit: WalletHit) => Promise<void>;
};

/**
 * Preserve the real fault and resit outcome, then verify a unique recovery transaction.
 * @param targetPage - Browser belonging to the actual failed wallet withdrawal.
 * @param room - Exact owned coin room.
 * @param hit - Actual scoped SDK wallet request.
 * @param tools - Authenticated native observation helpers.
 */
export async function verifyFaultAndRecovery(targetPage: Page, room: string, hit: WalletHit, tools: RecoveryTools) {
 const {report,evidence,walletControl,roomSnapshot,verifyFunds,screenshotAfterSettling}=tools;
 await expect(targetPage.getByTestId('buy-in-confirm-button')).toBeVisible({timeout:15000});
 await screenshotAfterSettling(targetPage,evidence+'/fault-automatic-rebuy.png');
 const faultRoom=roomSnapshot(room),faultLedger=await walletControl<WalletState>('state');
 report.roomAtFault=faultRoom;report.ledgerAtFault=faultLedger;report.fundsAtFault=verifyFunds(faultRoom,faultLedger);
 report.faultNotices=await targetPage.getByTestId('common-alert-message').or(targetPage.getByTestId('alert-message-text')).or(targetPage.getByTestId('toastText1')).filter({visible:true}).allTextContents();
 await targetPage.getByTestId('buy-in-close-button').click();
 await targetPage.getByTestId('in-game-container-seat').first().click();
 await expect(targetPage.getByTestId('common-alert-message').filter({visible:true}).or(targetPage.getByTestId('buy-in-confirm-button'))).toBeVisible({timeout:15000});
 await screenshotAfterSettling(targetPage,evidence+'/fault-resit.png');
 report.resitNotices=await targetPage.getByTestId('common-alert-message').filter({visible:true}).allTextContents();
 report.roomAfterResit=roomSnapshot(room);
 await repeatManualFailure(targetPage,hit,tools);
 if(hit.errorType==='insufficient_balance')report.insufficiencyRestore=await walletControl('reserve',{
  roomId:room,players:Object.keys(faultRoom.player_pool.players),restore:true});
 await walletControl('fault',{mode:'normal'});
 const before=await walletControl<WalletState>('state');
 await dismissWalletNotice(targetPage);
 for(const id of ['common-alert-button-undefined','common-alert-button-retry','common-alert-button-ok']){
  const close=targetPage.getByTestId(id);if(await close.isVisible())await close.click();
 }
 if(!await targetPage.getByTestId('buy-in-confirm-button').isVisible()){
  await targetPage.getByTestId('menu-button').click();await targetPage.getByTestId('drawer-menu-item-buy_in').click();
 }
 await expect(targetPage.getByTestId('buy-in-confirm-button')).toBeVisible();
 await targetPage.getByTestId('buy-in-text-input').fill('100');
 await targetPage.getByTestId('buy-in-confirm-button').click();
 await expect(targetPage.getByTestId('buy-in-confirm-button')).not.toBeVisible({timeout:15000});
 report.phase='verify-recovered-manual-stack-on-web';
 await expect.poll(async()=>Number(await targetPage.getByTestId('text-holdem-own-balance-text').textContent()),{timeout:20000}).toBeGreaterThanOrEqual(98);
 const after=await walletControl<WalletState>('state');
 assert.equal(before.balances[hit.player].coin-after.balances[hit.player].coin,100,'Recovery must withdraw exactly100');
 assert.equal(Object.keys(after.transactions).length-Object.keys(before.transactions).length,1,'Recovery must create exactly one transaction');
 const recoveredRoom=roomSnapshot(room);
 report.recovery={before,after,room:recoveredRoom,funds:verifyFunds(recoveredRoom,after)};
 await screenshotAfterSettling(targetPage,evidence+'/recovered-manual-buyin.png');
 assert.equal(verifyFunds(recoveredRoom,after).conserved,true,'Native wallet, table and pot funds must be conserved');
 if(hit.errorType==='insufficient_balance'){
  report.correctness={genuineInsufficientBalance:((report.repeatedManualNotices||[]) as string[]).some(text=>/insufficient|余额不足/i.test(text))};
  assert.equal(report.correctness.genuineInsufficientBalance,true,'Real insufficient balance must remain distinguishable');
  report.outcome='real-insufficient-balance-and-visible-recovery-passed';return;
 }
 report.correctness={originalWalletReasonReachesBrowser:report.faultNotices.some(text=>/transaction.*conflict|交易.*冲突/i.test(text))};
 report.phase='assert-actual-wallet-reason-on-web';
 assert.equal(report.correctness.originalWalletReasonReachesBrowser,true,'Non-balance wallet failure must reach the browser with its actual reason');
 report.outcome='fault-reason-and-recovery-passed';
}

/**
 * Dismiss the genuine insufficient-balance purchase offer through its visible cancel control.
 * @param page - Wallet owner's current browser.
 */
async function dismissWalletNotice(page: Page) {
 const cancel=page.getByTestId('common-alert-button-cancel').or(
  page.getByTestId('alert-custom-button').filter({hasText:/^(取消|cancel)$/i})).filter({visible:true});
 if(await cancel.isVisible())await cancel.click();
}

/**
 * Resubmit the visible manual buy-in while the fault or genuinely low balance persists.
 * @param page - Actual out-of-stack player's buy-in dialog.
 * @param hit - Original failed automatic request.
 * @param tools - Authenticated observations of the owned ledger.
 */
async function repeatManualFailure(page: Page, hit: WalletHit, tools: RecoveryTools) {
 const {report,evidence,walletControl,screenshotAfterSettling}=tools;
 const before=await walletControl<WalletState>('state');
 await page.getByTestId('buy-in-text-input').fill('100');
 await page.getByTestId('buy-in-confirm-button').click();
 await expect.poll(async()=>(await walletControl<WalletState>('state')).hits.length,{timeout:15000}).toBeGreaterThan(before.hits.length);
 await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible({timeout:15000});
 const notices=page.getByTestId('common-alert-message').or(page.getByTestId('alert-message-text')).or(page.getByTestId('toastText1')).filter({visible:true});
 await expect(notices.first()).toBeVisible({timeout:10000});
 report.repeatedManualNotices=await notices.allTextContents();
 const after=await walletControl<WalletState>('state');report.ledgerDuringRepeat=after;
 assert.ok(after.hits.slice(before.hits.length).some(item=>hit.mode?item.mode===hit.mode:item.errorType===hit.errorType),'Manual retry must hit the active wallet failure');
 assert.equal(Object.keys(after.transactions).length,Object.keys(before.transactions).length,'Rejected manual retry must not commit a deduction');
 await screenshotAfterSettling(page,evidence+'/fault-visible-manual-retry.png');
}

/**
 * Classify original empty replies alongside actual protocol and business failures.
 * @param record - Unmodified native RPC result.
 */
function isFailedReply(record: NativeRecord): boolean {
 return Boolean(record.reply?.error||record.reply?.result?.data===null||record.reply?.result?.data?.ok===false);
}

/**
 * Find a real failed RPC after this wallet attempt; its caller can differ from the losing player.
 * @param proxy - Native protocol bridge.
 * @param after - Native host timestamp in seconds.
 */
async function failedRpc(proxy: Mitmproxy, after: number): Promise<NativeRecord> {
 let failed: NativeRecord|undefined;
 await expect.poll(async()=>{
  const status=await proxy.command<NativeStatus>('native/status');
  failed=status.records.find(record=>record.event==='native-to-browser'&&(record.at||0)>=after&&
   isFailedReply(record));
  return Boolean(failed);
 },{timeout:25000}).toBe(true);
 assert.ok(failed,'No real failed RPC reached the browser');return failed;
}

/**
 * Locate the visible operation retry by its actual user-facing text, since both IDs may be undefined.
 * @param page - Browser whose genuine RPC failed.
 */
function operationRetry(page: Page) {
 return page.getByTestId(/^common-alert-button-(?!text-)/).filter({hasText:/^(重试|retry)$/i}).filter({visible:true});
}

/**
 * Observe a full SDK failure and retry once while the exact fault is still armed.
 * @param page - Actual RPC caller, not necessarily the wallet owner.
 * @param room - Exclusive native room.
 * @param hit - First failed automatic withdrawal.
 * @param proxy - Bridge retaining original replies.
 * @param tools - Authenticated native observations.
 */
async function repeatTransportFailure(page: Page, room: string, hit: WalletHit, proxy: Mitmproxy, tools: RecoveryTools) {
 const {report,evidence,walletControl,roomSnapshot,verifyFunds,screenshotAfterSettling}=tools;
 await expect(page.getByTestId('common-alert-message')).toBeVisible({timeout:15000});
 report.faultNotices=await page.getByTestId('common-alert-message').allTextContents();
 const ledger=await walletControl<WalletState>('state');const snapshot=roomSnapshot(room);
 report.ledgerAtFault=ledger;report.roomAtFault=snapshot;report.fundsAtFault=verifyFunds(snapshot,ledger);
 await screenshotAfterSettling(page,evidence+'/fault-operation-alert.png');
 const before=ledger.hits.length;const repeatedAt=Date.now()/1000;
 await operationRetry(page).click();
 await expect.poll(async()=>(await walletControl<WalletState>('state')).hits.length,{timeout:15000}).toBeGreaterThan(before);
 report.repeatedFailureReply=await failedRpc(proxy,repeatedAt);
 await expect(page.getByTestId('common-alert-message')).toBeVisible({timeout:10000});
 report.ledgerDuringRepeat=await walletControl<WalletState>('state');
 assert.ok((report.ledgerDuringRepeat as WalletState).hits.filter(item=>item.mode===hit.mode).length>
  ledger.hits.filter(item=>item.mode===hit.mode).length,'Visible retry must hit the still-active wallet fault');
 await screenshotAfterSettling(page,evidence+'/fault-visible-retry.png');
}

/**
 * Retry through the actual operation alert after restoring the wallet, preserving prior commits.
 * @param page - Actual caller's operation alert.
 * @param room - Owned room.
 * @param hit - Original failed wallet attempt.
 * @param proxy - Original native publications.
 * @param walletPage - Browser whose wallet funds the automatic rebuy.
 * @param tools - Wallet and engine observations.
 */
async function recoverTransport(page: Page, room: string, hit: WalletHit, proxy: Mitmproxy, walletPage: Page, tools: RecoveryTools) {
 const {report,evidence,walletControl,roomSnapshot,verifyFunds,screenshotAfterSettling,waitPublishedOutcome}=tools;
 await walletControl('fault',{mode:'normal'});
 const before=await walletControl<WalletState>('state');
 await operationRetry(page).click();
 let recoveredHit: WalletHit|undefined;
 await expect.poll(async()=>{
  const current=await walletControl<WalletState>('state');
  recoveredHit=current.hits.find(item=>!before.transactions[item.transaction]&&current.transactions[item.transaction]?.memo.match(/^\[(all_in|call|fold)\]Auto rebuy in:coin$/));
  return Boolean(recoveredHit);
 },{timeout:20000}).toBe(true);
 assert.ok(recoveredHit,'Visible recovery did not execute a real automatic withdrawal');
 await waitPublishedOutcome(proxy,recoveredHit);
 const after=await walletControl<WalletState>('state');const snapshot=roomSnapshot(room);
 const funds=verifyFunds(snapshot,after);
 report.recovery={before,after,room:snapshot,funds,recoveredHit};
 report.phase='verify-recovered-automatic-stack-on-web';
 await expect.poll(async()=>Number(await walletPage.getByTestId('text-holdem-own-balance-text').textContent()),{timeout:20000}).toBeGreaterThanOrEqual(98);
 assert.equal(snapshot.player_pool.players[recoveredHit.player].is_stand_up,false,'Recovered coin player must be seated in the real engine');
 assert.equal(before.balances[hit.player].coin-after.balances[hit.player].coin,100,'Recovery must withdraw exactly100');
 assert.equal(Object.keys(after.transactions).length-Object.keys(before.transactions).length,1,'Recovery must create exactly one transaction');
 await screenshotAfterSettling(page,evidence+'/recovered-operation-retry.png');
 report.correctness={readableFailure:report.faultNotices.every(text=>text.trim().length>0&&!/undefined|null|NaN/.test(text)),
  noFalseInsufficientBalance:report.faultNotices.every(text=>!/insufficient|余额不足|筹码不足/.test(text)),fundsConserved:funds.conserved};
 report.phase='assert-transport-error-readability-and-funds';
 assert.equal(report.correctness.readableFailure,true,'Transport failure must show a readable error');
 assert.equal(report.correctness.noFalseInsufficientBalance,true,'Non-balance transport failure must not claim insufficient balance');
 assert.equal(funds.conserved,true,'Native wallet, table and pot funds must be conserved after visible retry');
 report.outcome='transport-fault-visible-repeat-and-recovery-passed';
}

/**
 * Keep genuine transport failures distinct from swallowed wallet business errors.
 * @param pages - Both actual playing browsers.
 * @param owners - Verified actor identities in page order.
 * @param room - Exact native room.
 * @param hit - Actual first wallet attempt.
 * @param proxy - Native bridge with original wire payloads.
 * @param tools - Owned controls and snapshots.
 */
export async function verifyTransportAndRecovery(pages: Page[], owners: string[], room: string, hit: WalletHit, proxy: Mitmproxy, tools: RecoveryTools) {
 tools.report.phase='await-genuine-transport-rpc-failure';
 const failed=await failedRpc(proxy,hit.at);tools.report.failureReply=failed;
 const caller=owners.indexOf(failed.user||'');assert.ok(caller>=0,'Failed RPC caller must own a recorded browser');
 const page=pages[caller];
 tools.report.phase='repeat-genuine-transport-failure';
 await repeatTransportFailure(page,room,hit,proxy,tools);
 tools.report.phase='recover-genuine-transport-failure';
 await recoverTransport(page,room,hit,proxy,pages[owners.indexOf(hit.player)],tools);
}
