import type { BrowserContext } from '@playwright/test';
import texasHoldemHallFixture from '../../fixtures/hall-matching-texas-holdem.json';
import zhaJinHuaHallFixture from '../../fixtures/hall-matching-zhajinhua.json';

/** 视觉测试固定国家区号（中国），避免 Docker/CI 出口 IP 不同导致登录相关截图漂移 */
export const FIXED_COUNTRY_PHONE_CODE = '86';
export const USER_COUNTRY_CODE_STORAGE_KEY = 'app.user.country.code.key';


/**
 * mock 按 IP 取国家码接口，并固定 localStorage 区号。
 * 登录首页会请求该接口覆盖缓存；采集登录态与各场景都必须 mock，否则本地/CI 出口 IP 不一致会漂基线。
 */
export async function mockFixedCountryCode(context: BrowserContext): Promise<void> {
  await context.route(/\/public\/v10\/profile\/country/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { countryPhoneCode: FIXED_COUNTRY_PHONE_CODE },
      }),
    });
  });

  await context.addInitScript(
    ({ countryKey, countryCode }: { countryKey: string; countryCode: string }) => {
      window.localStorage.setItem(countryKey, countryCode);
    },
    { countryKey: USER_COUNTRY_CODE_STORAGE_KEY, countryCode: FIXED_COUNTRY_PHONE_CODE },
  );
}

/** 维护提醒与视觉场景无关；staging 对测试账号返回 401 会触发全局登出 */
export async function mockRoomDisallowRuleReminder(context: BrowserContext): Promise<void> {
  await context.route(/\/v2\/room\/disallow-rule\/reminder(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { enable: false, message: '' },
      }),
    }),
  );
}

const VISUAL_PROXY_HOST = '64.kr-seoul.api.staging.laiwan.shafayouxi.com';

/**
 * 固定远端代理列表。真实 metadata 会返回多个节点，其中失效节点也可能被下面的
 * 健康检查 mock 误判为可用，随后业务 API 才报 ERR_CONNECTION_CLOSED。
 * 视觉测试仍访问 staging 数据，但始终经由同一个已验证节点，避免随机换 host。
 */
async function mockProxyMetadata(context: BrowserContext): Promise<void> {
  await context.route(/\/public\/v13\/metadata\/servers(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          servers: {
            [VISUAL_PROXY_HOST]: '127.0.0.1',
          },
        },
      }),
    }),
  );
}

/**
 * 固定代理节点健康检查。只有 VISUAL_PROXY_HOST 返回正常；其余本地候选节点明确
 * 返回不可用，保证启动测速与后台 metadata 刷新都不会随机选中已断连的节点。
 */
async function mockProxyHealthChecks(context: BrowserContext): Promise<void> {
  await context.route(/\/node\/v1\/status(?:\?|$)/, (route) => {
    const hostname = new URL(route.request().url()).hostname;
    const selected = hostname === VISUAL_PROXY_HOST;
    return route.fulfill({
      status: selected ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(
        selected
          ? { backend_delay: 0, server_load: 'normal' }
          : { backend_delay: 0, server_load: 'unavailable' },
      ),
    });
  });
}

/**
 * 固定大厅公共牌局与可用版本：
 * - 牌局接口失败会把 "--" 占位符写进基准图
 * - available.json 默认 10s 超时，HallScreen 会在失败后弹「取消 / 重试」全局 Alert；
 *   Alert 可能在已经切到其它 tab 后才出现，污染任意登录场景
 */
async function mockHallMatchingGames(context: BrowserContext): Promise<void> {
  await context.route(/\/public\/v1\/hall_matching\/available\.json(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { available_url_version: ['v3'] },
      }),
    }),
  );
  await context.route(/\/public\/v1\/hall_matching\/texas_holdem\/halls$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(texasHoldemHallFixture),
    }),
  );
  await context.route(/\/public\/v1\/hall_matching\/zhajinhua\/halls$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(zhaJinHuaHallFixture),
    }),
  );
}

/** 固定登录账号的俱乐部、私人房与钱包数据，避免 staging 账号状态进入基准图 */
async function mockSignedInDynamicState(context: BrowserContext): Promise<void> {
  const fulfill = (route: Parameters<Parameters<BrowserContext['route']>[1]>[0], result: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result }),
    });

  await context.route(
    (url) => url.pathname === '/v10/club' && url.searchParams.has('user_id'),
    (route) => fulfill(route, { clubs: [] }),
  );
  await context.route(
    (url) => url.pathname === '/v10/clubs',
    (route) => fulfill(route, []),
  );
  await context.route(/\/v10\/house\/user\/[^/?]+(?:\?|$)/, (route) =>
    fulfill(route, {
      house_id: 'visual-house-id',
      user_id: 'visual-user-id',
      house_number: 123456789,
    }),
  );
  await context.route(/\/v10\/house\/users\/[^/]+\/visit_history(?:\?|$)/, (route) =>
    fulfill(route, { house_numbers: [] }),
  );
  await context.route(/\/v2\/building\/rooms(?:\?|$)/, (route) => fulfill(route, []));
  // 商城商品接口在 staging 偶发超时/返回空列表，会让商城只剩余额卡。
  // 固定为现有视觉基准使用的商品，避免 reference 依赖远端商品配置与网络时序。
  await context.route(/\/v\d+\/alipay_order\/goods(?:\?|$)/, (route) =>
    fulfill(route, [
      {
        id: 'com.ac.laiwandev.1.diamonds',
        subject: '1 diamond',
        amount: 1,
        total_amount: '0.01',
        bonus_amount: 1,
      },
      {
        id: 'com.ac.laiwandev.60.diamonds',
        subject: '60 diamonds',
        amount: 60,
        total_amount: '6',
        bonus_amount: 0,
      },
      {
        id: 'com.ac.laiwandev.120.diamonds',
        subject: '120 diamonds',
        amount: 120,
        total_amount: '12',
        bonus_amount: 5,
      },
      {
        id: 'com.ac.laiwandev.300.diamonds',
        subject: '300 diamonds',
        amount: 300,
        total_amount: '30',
        bonus_amount: 25,
      },
      {
        id: 'com.ac.laiwandev.1280.diamonds',
        subject: '1280 diamonds',
        amount: 1280,
        total_amount: '128',
        bonus_amount: 130,
      },
      {
        id: 'com.ac.laiwandev.3280.diamonds',
        subject: '3280 diamonds',
        amount: 3280,
        total_amount: '328',
        bonus_amount: 420,
      },
      {
        id: 'com.ac.laiwandev.6480.diamonds',
        subject: '6480 diamonds',
        amount: 6480,
        total_amount: '648',
        bonus_amount: 1050,
      },
    ]),
  );
  await context.route(
    /\/v11\/wallet\/[^/]+\/currency\/(?:coin|diamond)\/statement(?:\?|$)/,
    (route) => fulfill(route, { statements: [] }),
  );
  await context.route(/\/v2\/check_in\/seven_day\/rule(?:\?|$)/, (route) =>
    fulfill(
      route,
      Array.from({ length: 7 }, (_, index) => ({
        times: index + 1,
        reward: { coin: (index + 1) * 100 },
      })),
    ),
  );
  await context.route(/\/v2\/check_in\/seven_day\/current(?:\?|$)/, (route) =>
    fulfill(route, [{ check_in_at: new Date().toISOString() }]),
  );
  await context.route(/\/v10\/club\/application(?:\?|$)/, (route) =>
    fulfill(route, { applications: [] }),
  );
  await context.route(/\/v10\/buy_in\/auditor\/[^/]+\/applications\/pending(?:\?|$)/, (route) =>
    fulfill(route, { applications: [] }),
  );
}

/**
 * 为所有视觉测试浏览器上下文安装相同的网络稳定化 mock。
 *
 * 登录态采集会在场景开始前单独创建 context；它若跳过代理 metadata / 健康检查
 * mock，就会在应用启动阶段随机选中不可用的 staging 节点，根本无法进入登录页。
 */
export async function mockVisualNetworkDependencies(context: BrowserContext): Promise<void> {
  // Freshchat 在线客服脚本是外部第三方资源（web 构建用占位 token），
  // 拉取慢且与视觉测试无关，直接屏蔽。
  await context.route(/freshchat\.com/, (route) => route.abort());

  await mockProxyMetadata(context);
  await mockProxyHealthChecks(context);
  await mockFixedCountryCode(context);
  await mockRoomDisallowRuleReminder(context);
  await mockHallMatchingGames(context);
  await mockSignedInDynamicState(context);
}
