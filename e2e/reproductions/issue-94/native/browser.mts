/** Run genuine staging login, then owned native coin play with post-login recording only. */
import { chromium, expect, type BrowserContext, type Page, type Browser, type BrowserContextOptions } from '@playwright/test';
import type { Mitmproxy } from '../../../helpers/mitmproxy-client';
import type { NativeStatus, NativeReport, WalletState, WalletHit, NativeGamePublication, RoomSnapshot } from './types';
import { verifyFaultAndRecovery, verifyTransportAndRecovery } from './recovery.mjs';
import { safeDiagnosticReason } from '../../../../scripts/request-failure.cjs';
import * as pageModule from '../../../cases/_shared/page';
const { openHall, prepareContext } = compatibleModule(pageModule);
import * as authModule from '../../../cases/_shared/auth';
const { signIn, accountStatus } = compatibleModule(authModule);
import * as noticesModule from '../../../cases/_shared/sign-in-notices';
const { clickAfterSignInNotices } = compatibleModule(noticesModule);
import * as environmentModule from '../../../helpers/environment';
const { environment } = compatibleModule(environmentModule);
import * as proxyModule from '../../../helpers/mitmproxy-session';
const { withMitmproxy } = compatibleModule(proxyModule);
import * as screenModule from '../screenshot';
const { screenshotAfterSettling } = compatibleModule(screenModule);
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
/**
 * Resolve tsx interoperability without changing application modules.
 * @param value - Imported application helper namespace.
 */
function compatibleModule<T>(value: T & { default?: T }): T { return value.default ?? value; }
const root=process.env.ISSUE94_NATIVE_ROOT;
assert.ok(root,'Native stack root is required');
const evidence=process.env.ISSUE94_NATIVE_EVIDENCE_DIRECTORY;
assert.ok(evidence,'Native evidence directory is required');
const state=JSON.parse(await readFile(root+'/infrastructure.json','utf8'));
const controlKey=await readFile(root+'/wallet-control-key','utf8');
const mode=process.env.ISSUE94_NATIVE_MODE||'normal';
assert.ok(['normal','conflict','timeout','http-503','http-504','disconnect','invalid-json','missing-fields','committed-response-lost','insufficient'].includes(mode),'Unsupported native wallet case');
/**
 * Send authenticated controls only to the owned loopback wallet.
 * @param endpoint - Allowed control path suffix.
 * @param body - Optional control payload.
 */
async function walletControl<T = unknown>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
 const response=await fetch(`http://127.0.0.1:${state.walletPort}/_issue94/${endpoint}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Issue94-Control':controlKey},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(response.status,200,'Native wallet control HTTP failed');const result=await response.json();assert.equal(result.ok,true);return result.result as T;
}
/**
 * Read the actual native engine configuration without modifying it.
 * @param room - Owned room returned by real matching publications.
 */
function roomSnapshot(room: string): RoomSnapshot {
 return JSON.parse(execFileSync(root+'/sources/redis-7.2.5/src/redis-cli',['-c','-p',String(state.redisPorts[0]),'GET','texas_holdem:v1:room_id:'+room],{encoding:'utf8'}));
}

/**
 * Check actual wallet, active table and pot funds against the initial two-wallet total.
 * @param room - Snapshot read from real native Redis.
 * @param ledger - Actual local wallet ledger at this observation.
 */
function verifyFunds(room: RoomSnapshot, ledger: WalletState) {
 const players=room.player_pool.players;
 const walletCoin=Object.values(ledger.balances).reduce((sum,wallet)=>sum+wallet.coin,0);
 const tableCoin=Object.values(players).filter(player=>!player.is_stand_up&&!player.is_quit)
  .reduce((sum,player)=>sum+player.stack+player.buy_in_amount,0);
 const potCoin=room.pot.players.reduce((sum,user)=>sum+players[user].pay_amount,0);
 const total=walletCoin+tableCoin+potCoin;
 return {walletCoin,tableCoin,potCoin,total,expected:20000,conserved:total===20000};
}

/**
 * Keep known assertion descriptions while withholding arbitrary request diagnostics.
 * @param error - Untrusted browser or assertion exception.
 */
function failureReason(error: unknown): string {
 const message=error instanceof Error?error.message:'';
 const known=['Non-balance wallet failure must reach the browser with its actual reason',
  'No real automatic coin rebuy was observed','No real native game publication for wallet outcome',
  'Transport failure must show a readable error','Non-balance transport failure must not claim insufficient balance',
  'Native wallet, table and pot funds must be conserved','Real insufficient balance must remain distinguishable',
  'All-in slider must reach its actual maximum'];
 return known.find(value=>message.startsWith(value))||safeDiagnosticReason(error);
}

/**
 * Prove that neither another room nor another player can arm this dedicated instance.
 * @param room - Actual single-room native instance.
 * @param players - The two verified and exclusively locked users.
 */
async function verifyScopeRejection(room: string, players: string[]): Promise<void> {
 const before=await walletControl<WalletState>('state');
 const outcomes=[];
 for(const invalid of [{roomId:randomUUID(),players},{roomId:room,players:[players[0],randomUUID()]}]){
  const response=await fetch(`http://127.0.0.1:${state.walletPort}/_issue94/fault`,{method:'POST',
   headers:{'Content-Type':'application/json','X-Issue94-Control':controlKey},body:JSON.stringify({mode:'conflict',...invalid})});
  const rejected=await response.json();
  assert.equal(response.status,400);assert.equal(rejected.error_type,'isolated_scope_rejected');
  outcomes.push({status:response.status,errorType:rejected.error_type});
 }
 const after=await walletControl<WalletState>('state');
 assert.deepEqual(after.fault,before.fault,'Rejected foreign scopes must not arm or change a wallet fault');
 report.scopeRejectionChecks=outcomes;
}
const candidate=execFileSync('python3',['-c',`import ast,subprocess
s=subprocess.check_output(['git','show','HEAD:src/configs.py'],cwd=__import__('sys').argv[1],text=True)
t=ast.parse(s)
for c in t.body:
 if isinstance(c,ast.ClassDef) and c.name=='Staging':
  for a in c.body:
   if isinstance(a,ast.Assign) and any(isinstance(n,ast.Name) and n.id=='CENTRIFUGO_SECRET_KEY_V2' for n in a.targets):
    print(ast.literal_eval(a.value),end='')
`, process.env.ISSUE94_AUTH_SOURCE_ROOT!],{encoding:'utf8'});
assert.ok(candidate,'No candidate staging JWT signing configuration');
const report: NativeReport={faultNotices:[],scope:'native coin service path; wallet business and transport faults; broader issue94 matrix tracked separately',steps:[],outcome:'running'};
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch();
const contexts: BrowserContext[]=[];
/**
 * Log in both exclusive accounts normally and verify their genuine socket credentials.
 * @param browser - Chromium browser without prerecorded authentication state.
 * @param proxy - Transparent per-case proxy and authenticated native controls.
 * @param options - Normal unrecorded browser context settings.
 */
async function loginActors(browser: Browser, proxy: Mitmproxy, options: BrowserContextOptions) {
 const credentials=[{username:process.env.E2E_TEST_USERNAME!,password:process.env.E2E_TEST_PASSWORD!},
  {username:process.env.ISSUE94_PEER_USERNAME!,password:process.env.ISSUE94_PEER_PASSWORD!}];
 const actors=[];
 for(let index=0;index<2;index++){
  console.log(JSON.stringify({phase:'normal-stage-login',actor:index}));
  const device=randomUUID();const context=await browser.newContext(options);contexts.push(context);
  await prepareContext(context,device);const page=await context.newPage();
  await openHall(page);const session=await signIn(page,credentials[index]);
  assert.equal(await accountStatus(page,session),200);
  await clickAfterSignInNotices(page,'hall-tab');
  const saved=await page.evaluate(()=>localStorage.getItem('user.centrifuge.v2.save.key'));
  assert.ok(saved,'No genuine Centrifugo cache');
  const parsed=/^[\s]*[{"]/.test(saved)?JSON.parse(saved):saved;const token=typeof parsed==='string'?parsed:parsed.token;
  assert.equal(typeof token,'string','No genuine Centrifugo token');
  const [header,payload,signature]=token.split('.');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(claims.sub,session.userId,'Genuine socket identity differs from verified API session');
  const expected=createHmac('sha256',candidate).update(header+'.'+payload).digest();
  const actual=Buffer.from(signature,'base64url');
  assert.ok(actual.length===expected.length&&timingSafeEqual(actual,expected),'Candidate signing configuration does not match genuine staging token');
  const walletResponse=await page.request.put(new URL('/v10/wallet/'+session.userId,session.accountUrl).href,{headers:{Authorization:session.authorization},data:{currencies:['coin','diamond']}});
  assert.equal(walletResponse.status(),200,'Actual stage wallet HTTP failed');const wallet=await walletResponse.json();assert.equal(wallet.ok,true,'Actual stage wallet business response failed: '+wallet.error_type);
  const balances=Object.fromEntries(wallet.result.currencies.map((item: { code?: string; currency_name: string; balance: string })=>[item.code??item.currency_name,item.balance]));
  assert.ok(Number(balances.coin)>=200,'Actual account balance too low for native coin baseline');
  console.log(JSON.stringify({phase:'verified-account-identity',actor:index,user:session.userId,distinctFromEarlier:actors.every(a=>a.session.authorization!==session.authorization)}));
  const bound=await proxy.command<NativeStatus>('native/bind',{...session,centrifugoToken:token},25000);assert.equal(bound.owners,index+1);
  actors.push({session,balances,device,storageState:await context.storageState()});
  await context.close();
  report.steps.push({event:'genuine-stage-login-and-key-verified',actor:index,user:session.userId});
 }
 return actors;
}

/**
 * Use the actual betting controls and numeric keypad to request all-in.
 * @param page - Current authenticated coin table.
 * @param index - Actor number for sanitized evidence.
 */
async function playAllIn(page: Page, index: number) {
 const allIn=page.getByTestId('texas-holdem-operation-button-all_in');
 if(await allIn.isVisible()){await allIn.click();report.steps.push({event:'web-all-in-click',actor:index});}
 else if(await page.getByTestId('texas-holdem-operation-accurate-bet-button').isVisible()){
  report.phase='all-in-through-accurate-bet-input';
  await page.getByTestId('texas-holdem-operation-accurate-bet-button').click();
  await expect(page.getByTestId('accurate-bet-popup-container')).toBeVisible();
  // The real keypad clamps input to the current maximum; confirming that value requests all-in.
  for(let digit=0;digit<6;digit++)await page.getByTestId('texas-holdem-operation-accurate-bet-number-button-9').click();
  await page.getByTestId('texas-holdem-operation-accurate-bet-confirm-button').click();
  await expect(page.getByTestId('accurate-bet-popup-container')).not.toBeVisible();
  report.steps.push({event:'web-all-in-click',actor:index});
 }
}

/**
 * Separate real low ledger balance from injected business and transport faults.
 * @param ledger - Actual isolated wallet state.
 */
function hasWalletOutcome(ledger: WalletState): boolean {
 if(mode==='insufficient')return ledger.hits.some(hit=>hit.errorType==='insufficient_balance');
 if(mode!=='normal')return ledger.hits.some(hit=>hit.mode===mode);
 return Object.values(ledger.transactions).some(transaction=>/^\[(all_in|call|fold)\]Auto rebuy in:coin$/.test(transaction.memo));
}

/**
 * Play real hands until the SDK makes the required normal or scoped fault request.
 * @param pages - Two authenticated native coin table pages.
 */
async function playUntilWalletOutcome(pages: Page[]): Promise<WalletHit> {
 const deadline=Date.now()+90000;
 let autoRebuy=false;
 while(Date.now()<deadline){
  for(let index=0;index<2;index++){
   await playAllIn(pages[index],index);
  }
  const response=await fetch(`http://127.0.0.1:${state.walletPort}/_issue94/state`,{headers:{'X-Issue94-Control':controlKey}});
  const ledger=await response.json() as { result: WalletState };report.ledger=ledger.result;
  autoRebuy=hasWalletOutcome(ledger.result);
  if(autoRebuy)break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(autoRebuy,'No real automatic coin rebuy was observed');
 assert.ok(report.ledger,'No wallet observation recorded');
 const observedLedger=report.ledger;
 const autoTransaction=Object.entries(observedLedger.transactions).find(([,transaction])=>/^\[(all_in|call|fold)\]Auto rebuy in:coin$/.test(transaction.memo));
 const hit=mode==='normal'?observedLedger.hits.find(hit=>hit.transaction===autoTransaction?.[0]):observedLedger.hits.find(hit=>mode==='insufficient'?hit.errorType==='insufficient_balance':hit.mode===mode);
 assert.ok(hit,'No matching wallet hit recorded');
 return hit;
}

/**
 * Restore explicitly reserved setup funds before final owned-room cleanup.
 * @param room - This run's actual room.
 * @param owners - The two verified players.
 */
async function restoreReserves(room: string, owners: string[]): Promise<void> {
 if(report.insufficiencySetup)await walletControl('reserve',{roomId:room,players:owners,restore:true});
}

/**
 * Exit both owned players through the real API before closing their room.
 * @param room - Exact room created by the isolated matching service.
 * @param owners - Identities validated by real login and exclusive account locks.
 */
async function quitOwnedPlayers(room: string, owners: string[]): Promise<void> {
 for(const user of owners){
  const quit=await fetch(`http://127.0.0.1:${state.texasPort}/service/v10/texas_holdem/room/${room}/quit`,{
   method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:user})});
  assert.equal(quit.status,200);assert.equal((await quit.json()).ok,true);
 }
}

/**
 * Wait for this exact wallet attempt's real publication and its full animation schedule.
 * @param proxy - Native bridge with original publication payloads.
 * @param hit - Actual SDK request with its native-host timestamp.
 */
async function waitPublishedOutcome(proxy: Mitmproxy, hit: WalletHit): Promise<void> {
 report.phase='await-native-wallet-publication';
 let relevant: NativeGamePublication|undefined;
 await expect.poll(async()=>{
  const status=await proxy.command<NativeStatus>('native/status');
  const publications=status.records.flatMap(record=>record.event==='native-to-browser'&&record.publication?.data?.stream==='texas_holdem'?[record.publication.data]:[]);
  relevant=publications.filter(publication=>Date.parse(publication.sent_at+'Z')>=hit.at*1000-5&&publication.queue.some(item=>item.player_id===hit.player&&['deposit_buy_in','stand_up','prompt_buy_in'].includes(item.event))).at(-1);
  return Boolean(relevant);
 },{timeout:15000}).toBe(true);
 assert.ok(relevant,'No real native game publication for wallet outcome');
 const completeAt=Date.parse(relevant.sent_at+'Z')+Math.max(...relevant.queue.map(item=>item.delay_seconds||0))*1000;
 report.phase='wait-native-publication-animation-schedule';
 await expect.poll(()=>Date.now()>=completeAt,{timeout:25000}).toBe(true);
}

try {
 await withMitmproxy(async proxy=>{
  const options={baseURL:environment.stagingUrl,ignoreHTTPSErrors:true,proxy:{server:proxy.server,bypass:'<-loopback>'},viewport:{width:1280,height:720}};
  const actors=await loginActors(browser,proxy,options);
  const keys=JSON.parse(await readFile(root+'/centrifugo-config.json','utf8'));
  keys.token_hmac_secret_key=candidate;
  await writeFile(root+'/centrifugo-config.json',JSON.stringify(keys),{mode:0o600});await chmod(root+'/centrifugo-config.json',0o600);
  const centrifugoPid=Number(execFileSync('pgrep',['-f','^'+root+'/tools/centrifugo/centrifugo'],{encoding:'utf8'}).trim());
  assert.ok(centrifugoPid>0);process.kill(centrifugoPid,'SIGHUP');
  const seeded=await fetch(`http://127.0.0.1:${state.walletPort}/_issue94/seed`,{method:'POST',headers:{'Content-Type':'application/json','X-Issue94-Control':controlKey},
   body:JSON.stringify({balances:Object.fromEntries(actors.map(a=>[a.session.userId,a.balances]))})});
  assert.equal(seeded.status,200);assert.equal((await seeded.json()).ok,true);
  await proxy.command('native/enable',{});
  const pages: Page[]=[];
  try{
   for(let index=0;index<2;index++){
    console.log(JSON.stringify({phase:'normal-authenticated-restart',actor:index}));
    const actor=actors[index];const context=await browser.newContext({...options,storageState:actor.storageState,recordVideo:{dir:evidence,size:{width:1280,height:720}}});
    contexts.push(context);await prepareContext(context,actor.device);const page=await context.newPage();pages.push(page);
    await openHall(page);await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({timeout:60000});
    await clickAfterSignInNotices(page,'hall-tab');
    await screenshotAfterSettling(page,evidence+`/actor${index}-hall.png`);
   }
   await expect.poll(async()=>{const status=await proxy.command<NativeStatus>('native/status');return status.connections.filter(c=>c.subscriptions.includes('user#'+c.user)).length;},{timeout:30000}).toBe(2);
   console.log(JSON.stringify({phase:'actual-web-coin-match'}));
   for(const page of pages)await page.getByTestId('match-game-item-texas_holdem-tourists').click();
   await Promise.all(pages.map(async(page,index)=>{
    await expect(pages[index].getByTestId('run-game-view')).toBeVisible({timeout:60000});
    await expect(pages[index].getByTestId('text-holdem-own-balance-text')).toBeVisible({timeout:60000});
    report.steps.push({event:'actual-web-coin-table-ready',actor:index});
   }));
   await Promise.all(pages.map(async(page,index)=>{
    await page.getByTestId('auto-rebuy-button').click();
    await page.getByTestId('auto-rebuy-switch').getByRole('switch').check();
    await page.getByTestId('auto-rebuy-close-button').click();
    await page.getByTestId('menu-button').click();
    await page.getByTestId('drawer-menu-item-buy_in').click();
    await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible();
    await screenshotAfterSettling(page,evidence+`/actor${index}-manual-buyin.png`);
    await page.getByTestId('buy-in-confirm-button').click();
    await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible({timeout:30000});
    report.steps.push({event:'manual-buy-in-request-completed',actor:index});
   }));
   const room=(await proxy.command<NativeStatus>('native/status')).rooms[0];
   report.phase='verify-owned-scope-rejection';
   await verifyScopeRejection(room,actors.map(actor=>actor.session.userId));
   if(mode==='insufficient')report.insufficiencySetup=await walletControl('reserve',{roomId:room,players:actors.map(a=>a.session.userId)});
   else if(mode!=='normal')report.faultScope=await walletControl('fault',{mode,roomId:room,players:actors.map(a=>a.session.userId)});
   const hit=await playUntilWalletOutcome(pages);
   const target=actors.findIndex(a=>a.session.userId===hit.player);assert.ok(target>=0);
   const targetPage=pages[target];
   // Publications carry future game animation delays. Wait through that schedule before checking final UI.
   const recoveryTools={report,evidence,walletControl,roomSnapshot,verifyFunds,screenshotAfterSettling,waitPublishedOutcome};
   if(!['normal','conflict','insufficient'].includes(mode)){
    await verifyTransportAndRecovery(pages,actors.map(actor=>actor.session.userId),room,hit,proxy,recoveryTools);
   }else{
   await waitPublishedOutcome(proxy,hit);
   if(mode==='normal'){
    report.phase='assert-displayed-automatic-rebuy';
    assert.equal(hit.amount,100,'Normal automatic rebuy must withdraw the actual configured minimum100');
    await expect.poll(async()=>Number(await targetPage.getByTestId('text-holdem-own-balance-text').textContent()),{timeout:10000}).toBeGreaterThanOrEqual(98);
    await screenshotAfterSettling(targetPage,evidence+'/normal-automatic-rebuy-displayed.png');
    const displayedRoom=roomSnapshot(room),displayedLedger=await walletControl<WalletState>('state');
    report.roomAfterAutomaticRebuy=displayedRoom;report.ledgerAfterAutomaticRebuy=displayedLedger;
    report.fundsAfterAutomaticRebuy=verifyFunds(displayedRoom,displayedLedger);
    assert.equal(verifyFunds(displayedRoom,displayedLedger).conserved,true,'Native wallet, table and pot funds must be conserved');
    report.outcome='normal-manual-buyin-and-automatic-rebuy';
   }else{
    await verifyFaultAndRecovery(targetPage,room,hit,recoveryTools);
   }
   }
  }finally{for(let i=0;i<pages.length;i++){if(!pages[i].isClosed())await screenshotAfterSettling(pages[i],evidence+`/actor${i}-outcome.png`).catch(()=>{});}report.bridge=await proxy.command<NativeStatus>('native/status');}
 },{addonPath:new URL('./native_bridge.py',import.meta.url).pathname});
}catch(error){report.outcome='failed';report.failure=String(report.phase||'native-case')+': '+failureReason(error);process.exitCode=1;}
finally{
 const cleanupErrors: string[]=[];
 await walletControl('fault',{mode:'normal'}).catch(()=>cleanupErrors.push('Clearing the owned wallet fault failed'));
 for(const context of contexts)await context.close().catch(()=>{});
 await browser.close();
 const bridge=report.bridge as NativeStatus|undefined;
 const owners=report.steps.flatMap(step=>step.event==='genuine-stage-login-and-key-verified'&&step.user?[step.user]:[]);
 for(const room of bridge?.rooms||[]){
  try{
   assert.match(room,/^[a-f0-9-]{36}$/);
   await restoreReserves(room,owners);
   await quitOwnedPlayers(room,owners);
   const response=await fetch(`http://127.0.0.1:${state.texasPort}/service/v10/texas_holdem/room/${room}/close`,{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({close_reason:'issue94-owned-native-cleanup'})});
   assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
   report.closedRoom=roomSnapshot(room);
  }catch{cleanupErrors.push('Closing the exact owned native room failed');}
 }
 try{
  const ledger=await walletControl<WalletState>('state');report.finalLedger=ledger;
  if(bridge?.rooms.length){
   const coin=owners.reduce((sum,user)=>sum+ledger.balances[user].coin,0);
   report.finalFunds={walletCoin:coin,expected:20000,conserved:coin===20000};
   assert.equal(coin,20000,'Closing the owned native room must restore the two initial balances in total');
  }
 }catch{cleanupErrors.push('Final native wallet conservation check failed');}
 if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;process.exitCode=1;report.outcome='failed';}
 await writeFile(evidence+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({outcome:report.outcome,steps:report.steps,failure:report.failure,report:evidence+'/report.json'}));
}
