import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { androidScenarios, nativeSelector, unavailablePages } = require('./scenarios.ts');
const { visualNetworkRouter } = require('./network-routes.ts');

test('原生选择器不忽略 Web 复杂 CSS，前后缀匹配保留字面字符', () => {
  assert.deepEqual(nativeSelector('[data-testid="password-input"] input'), { res: 'password-input' });
  const prefix = nativeSelector('[data-testid^="product.amount-"]').res;
  assert.ok(prefix.test('product.amount-60'));
  assert.ok(!prefix.test('productXamount-60'));
  assert.throws(() => nativeSelector('[data-testid="container"] > :last-child'));
});

test('三种语言沿用相同的 Web 手机业务页面，渠道差异显式列出', () => {
  const english = androidScenarios('en').map(scenario => scenario.pageLabel);
  const { buildScenarios } = require('../visual/scenarios.ts');
  const web = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SCOPE: 'full', VISUAL_SUITE: 'app' })
    .filter(scenario => scenario.viewport.label === 'mobile' && scenario.group !== 'game-record');
  assert.deepEqual(web.filter(scenario => !english.includes(scenario.pageLabel)).map(scenario => scenario.pageLabel), unavailablePages);
  assert.equal(new Set(english).size, english.length);
  for (const locale of ['zh-Hans', 'zh-Hant']) {
    assert.deepEqual(androidScenarios(locale).map(scenario => scenario.pageLabel), english);
  }
  for (const scenario of androidScenarios('en')) {
    assert.equal(scenario.viewport.label, 'mobile');
    nativeSelector(scenario.visualReadySelector);
    if (scenario.visualGoneSelector) nativeSelector(scenario.visualGoneSelector);
  }
});

test('原生传输复用 Web 的动态 URL、商品和国家夹具，真实认证继续透传', async () => {
  const route = await visualNetworkRouter();
  const origin = 'https://64.kr-seoul.api.staging.laiwan.shafayouxi.com';
  assert.equal(await route(`${origin}/public/v10/user/login/username/password`), null);
  assert.equal(await route(`${origin}/v10/club`), null);
  assert.deepEqual(JSON.parse((await route(`${origin}/v10/club?user_id=example`)).body),
    { ok: true, result: { clubs: [] } });
  assert.equal(JSON.parse((await route(`${origin}/public/v10/profile/country`)).body).result.countryPhoneCode, '86');
  assert.equal(JSON.parse((await route(`${origin}/v10/alipay_order/goods`)).body).result.length, 7);
  assert.equal((await route('https://widget.freshchat.com/')).aborted, true);
  const feedback = await route('https://feedback.userreport.com/visual-fixture/');
  assert.equal(feedback.contentType, 'text/html; charset=utf-8');
  assert.match(feedback.body, /<body[^>]*><\/body>/);
});


test('业务分组完整分割清单且没有重复或遗漏', () => {
  const combined = ['guest', 'account', 'social', 'rooms', 'wallet-help']
    .flatMap(group => androidScenarios('en', group).map(scenario => scenario.pageLabel));
  assert.deepEqual(combined.sort(), androidScenarios('en').map(scenario => scenario.pageLabel).sort());
  assert.throws(() => androidScenarios('en', 'typo'));
});

test('牌桌保留真实房屋接口，战绩代理的俱乐部数据不被通用夹具覆盖', async () => {
  const route = await visualNetworkRouter({ realPrivateRoom: true, recordFixtures: true });
  for (const path of ['/v10/house/user/self', '/v2/building/rooms', '/v10/club?user_id=self', '/v10/clubs']) {
    assert.equal(await route(`https://api.shafayouxi.org${path}`), null);
  }
  assert.ok(await route('https://api.shafayouxi.org/v10/alipay_order/goods'));
});

test('动态区域遮罩保留区域外像素，拒绝掩盖整页', () => {
  const { PNG } = require('pngjs');
  const { maskScreenshot } = require('./screenshot.ts');
  const original = new PNG({ width: 100, height: 100 });
  original.data.fill(255);
  const bytes = PNG.sync.write(original);
  const masked = PNG.sync.read(maskScreenshot(bytes, [{ x: 10, y: 20, width: 10, height: 10, reason: '日期' }]));
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const pixel = [...masked.data.subarray((y * 100 + x) * 4, (y * 100 + x + 1) * 4)];
    assert.deepEqual(pixel, x >= 10 && x < 20 && y >= 20 && y < 30 ? [230, 210, 235, 255] : [255, 255, 255, 255]);
  }
  assert.throws(() => maskScreenshot(bytes, [{ x: 0, y: 0, width: 100, height: 100, reason: '错误范围' }]), /12%/);
});


test('原生战绩与 Web 共用完整状态矩阵', () => {
  const { recordStates } = require('./record-states.ts');
  const { LEGACY_STATES, V2_STATES } = require('../visual/cases/game-record/scenarios.ts');
  assert.deepEqual(recordStates.legacy, LEGACY_STATES);
  assert.deepEqual(recordStates.v2, V2_STATES);
  for (const states of Object.values(recordStates)) assert.equal(new Set(states).size, states.length);
  assert.deepEqual(androidScenarios('en', 'records'), []);
});

test('原生德州覆盖完整 Web 手机场景清单，新增场景不能被静默过滤', () => {
  const { texasScenarioLabels } = require('./texas-flows.ts');
  const { buildScenarios } = require('../visual/scenarios.ts');
  const scenarios = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SCOPE: 'full', VISUAL_SUITE: 'texas' })
    .filter(scenario => scenario.viewport.label === 'mobile');
  assert.deepEqual([...texasScenarioLabels].sort(), scenarios.map(scenario => scenario.pageLabel).sort());
  assert.equal(scenarios.reduce((total, scenario) => total + scenario.snapshotStates.length, 0), 95);
});


test('原生控件消失查询不把连接或驱动错误误认为成功', async () => {
  const { exists } = require('./native-state.ts');
  const ready = { res: 'ready', bounds: { x: 0, y: 10, width: 100, height: 20 } };
  assert.equal(await exists({ info: /** 模拟存在的原生控件。 */ async () => ready }, { res: 'ready' }), true);
  assert.equal(await exists({ info: /** 模拟保留在屏外的历史弹层。 */ async () => ({ ...ready,
    bounds: { x: 0, y: 1300, width: 100, height: -20 } }) }, { res: 'ready' }), false);
  assert.equal(await exists({ info: /** 模拟原生查询空结果。 */ async () => { throw new Error('java.lang.NullPointerException'); } }, { res: 'gone' }), false);
  await assert.rejects(exists({ info: /** 模拟连接中断。 */ async () => { throw new Error('Device closed'); } }, { res: 'gone' }), /Device closed/);
  let calls = 0;
  assert.equal(await exists({ info: /** 模拟转场后重新挂载的控件。 */ async () => {
    if (calls++ === 0) throw new Error('androidx.test.uiautomator.StaleObjectException');
    return ready;
  } }, { res: 'ready' }), true);
  assert.equal(calls, 2);
});
