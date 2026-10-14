import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { androidScenarios, nativeSelector } = require('./scenarios.ts');
const { visualNetworkRouter } = require('./network-routes.ts');

test('原生选择器不忽略 Web 复杂 CSS，前后缀匹配保留字面字符', () => {
  assert.deepEqual(nativeSelector('[data-testid="password-input"] input'), { res: 'password-input' });
  const prefix = nativeSelector('[data-testid^="product.amount-"]').res;
  assert.ok(prefix.test('product.amount-60'));
  assert.ok(!prefix.test('productXamount-60'));
  assert.throws(() => nativeSelector('[data-testid="container"] > :last-child'));
});

test('三种语言沿用完全相同的 Web 手机业务页面清单且每页唯一', () => {
  const english = androidScenarios('en').map(scenario => scenario.pageLabel);
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
});
