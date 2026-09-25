/**
 * 场景级 context 设置：
 * 语言/deviceId/新手引导标记、登录态注入、易碎接口 mock。
 * 必须在 page.goto 之前调用。
 */

import type { BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import texasHoldemHallFixture from '../../fixtures/hall-matching-texas-holdem.json';
import zhaJinHuaHallFixture from '../../fixtures/hall-matching-zhajinhua.json';
import { LANGUAGE_STORAGE_KEY, type VisualScenario } from '../../scenarios';

export const AUTH_STATE_PATH = path.resolve(__dirname, '..', '..', 'auth-state.json');

/** 视觉测试固定国家区号（中国），避免 Docker/CI 出口 IP 不同导致登录相关截图漂移 */
export const FIXED_COUNTRY_PHONE_CODE = '86';
const USER_COUNTRY_CODE_STORAGE_KEY = 'app.user.country.code.key';

type AuthStateArgs = {
  entries: Record<string, string>;
  langKey: string;
  countryKey: string;
  countryCode: string;
};

function injectAuthState({ entries, langKey, countryKey, countryCode }: AuthStateArgs): void {
  Object.entries(entries).forEach(([key, value]) => {
    if (key !== langKey) {
      window.localStorage.setItem(key, value);
    }
  });
  window.localStorage.setItem(countryKey, countryCode);
}

function buildAuthStateArgs(entries: Record<string, string>): AuthStateArgs {
  return {
    entries,
    langKey: LANGUAGE_STORAGE_KEY,
    countryKey: USER_COUNTRY_CODE_STORAGE_KEY,
    countryCode: FIXED_COUNTRY_PHONE_CODE,
  };
}

/** 读取本次运行采集的登录态；不存在/损坏时返回 null，由场景明确失败。 */
function readAuthStateEntries(): Record<string, string> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const entries = raw?.entries;
    if (entries && typeof entries === 'object' && Object.keys(entries).length > 0) {
      return entries as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return null;
}

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

/** Docker/Linux 下 Chromium 可能上报 en-US@posix，Intl / react-native-localize 会直接抛错白屏 */
export async function fixNavigatorLanguage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'language', {
        get: () => 'en-US',
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
    } catch {
      // ignore
    }
  });
}

/**
 * 禁用动画：
 * - CSS animation/transition（配合 toHaveScreenshot 的 animations: 'disabled'）
 * - 标记 __VISUAL_REGRESSION__，供业务侧跳过 RN Animated / setTimeout 驱动的动效
 *   （例如大厅 Slot 横幅每 4s 的 random spinTo，CSS 关不住）
 */
export async function disableAnimations(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    (globalThis as typeof globalThis & { __VISUAL_REGRESSION__?: boolean }).__VISUAL_REGRESSION__ =
      true;

    const id = 'visual-disable-animations';
    const css = `
      *, *::before, *::after {
        animation: none !important;
        animation-delay: 0s !important;
        transition: none !important;
        scroll-behavior: auto !important;
        -webkit-font-smoothing: antialiased !important;
        text-rendering: geometricPrecision !important;
      }
    `;
    const inject = () => {
      const parent = document.head || document.documentElement;
      if (!parent || document.getElementById(id)) {
        return;
      }
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      parent.appendChild(style);
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
  });
}

/** 采集态里与登录无关、可安全复用的缓存键（主题等；国家码已由 mockFixedCountryCode 固定） */
const SAFE_CACHE_KEYS = ['app.theme.id.key'];

/** 在 BrowserContext 创建阶段预置 localStorage，确保早于应用 bundle 初始化 */
export function buildStorageStateForScenario(
  scenario: VisualScenario,
  baseUrl: string,
): BrowserContextOptions['storageState'] {
  const authEntries = readAuthStateEntries();
  const entries: Record<string, string> = {};

  if (scenario.signIn && authEntries) {
    Object.assign(entries, authEntries);
  } else if (!scenario.signIn && authEntries) {
    SAFE_CACHE_KEYS.forEach((key) => {
      if (authEntries[key] !== undefined) {
        entries[key] = authEntries[key];
      }
    });
  }

  Object.assign(entries, {
    [LANGUAGE_STORAGE_KEY]: scenario.locale,
    deviceId: scenario.deviceId,
    'hall.screen.tutorial.complete.key': 'true',
    'personal.house.screen.tutorial.complete.key': 'true',
    'create.room.screen.tutorial.complete.key': 'true',
    [USER_COUNTRY_CODE_STORAGE_KEY]: FIXED_COUNTRY_PHONE_CODE,
  });

  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseUrl).origin,
        localStorage: Object.entries(entries).map(([name, value]) => ({ name, value })),
      },
    ],
  };
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

export async function setupContextForScenario(
  context: BrowserContext,
  scenario: VisualScenario,
  page?: Page,
): Promise<void> {
  await fixNavigatorLanguage(context);
  await disableAnimations(context);
  await mockVisualNetworkDependencies(context);

  await context.addInitScript(
    ({ locale, langKey, deviceId }: { locale: string; langKey: string; deviceId: string }) => {
      window.localStorage.setItem(langKey, locale);
      // 固定 deviceId（所有场景，含未登录）：随机 deviceId 会让启动期设备注册
      // 回调在点击后触发导航重置，杀掉刚打开的登录 modal
      window.localStorage.setItem('deviceId', deviceId);
      // 三个 copilot 新手引导全部标记为已完成，避免遮挡截图
      window.localStorage.setItem('hall.screen.tutorial.complete.key', 'true');
      window.localStorage.setItem('personal.house.screen.tutorial.complete.key', 'true');
      window.localStorage.setItem('create.room.screen.tutorial.complete.key', 'true');
    },
    { locale: scenario.locale, langKey: LANGUAGE_STORAGE_KEY, deviceId: scenario.deviceId },
  );

  const authEntries = readAuthStateEntries();
  // 采集态里可能带有按 IP 得到的区号；统一改写，避免覆盖上面的固定值
  if (authEntries) {
    authEntries[USER_COUNTRY_CODE_STORAGE_KEY] = FIXED_COUNTRY_PHONE_CODE;
  }

  if (scenario.signIn) {
    // 注入当前分片开始前采集的登录态（localStorage），免去逐场景 UI 登录；
    // 语言键已在采集时剔除，不会覆盖上面的语言设置
    if (authEntries) {
      const authStateArgs = buildAuthStateArgs(authEntries);
      await context.addInitScript(injectAuthState, authStateArgs);
      // Playwright 的 page fixture 已在 beforeEach 创建。也注册到该页面，确保其
      // 下一次导航一定带上登录态，而不是只影响随后新建的 page。
      if (page) {
        await page.addInitScript(injectAuthState, authStateArgs);
      }
    }

    // 意见反馈页嵌入第三方 UserReport；列表内容随远端变化，mock 成空白页保证截图稳定
    await context.route(/feedback\.userreport\.com/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f5f5"></body></html>',
      }),
    );
  } else if (authEntries) {
    // 未登录场景也复用与登录无关的安全缓存键（主题等；国家码已由 mockFixedCountryCode 固定）
    const safeEntries = Object.fromEntries(
      SAFE_CACHE_KEYS.filter((key) => authEntries[key] !== undefined).map((key) => [
        key,
        authEntries[key],
      ]),
    );
    if (Object.keys(safeEntries).length > 0) {
      await context.addInitScript((entries: Record<string, string>) => {
        Object.entries(entries).forEach(([key, value]) => {
          window.localStorage.setItem(key, value);
        });
      }, safeEntries);
    }
  }
}
