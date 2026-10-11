/**
 * 场景级 context 设置：
 * 语言/deviceId/新手引导标记、登录态注入、易碎接口 mock。
 * 必须在 page.goto 之前调用。
 */

import type { BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LANGUAGE_STORAGE_KEY, type VisualScenario } from '../../scenarioTypes';
import { mockDailyBonusWallet } from '../../cases/hall/walletPresentation';
import {
  FIXED_COUNTRY_PHONE_CODE,
  USER_COUNTRY_CODE_STORAGE_KEY,
  mockVisualNetworkDependencies,
} from './networkMocks';
export {
  FIXED_COUNTRY_PHONE_CODE,
  mockFixedCountryCode,
  mockRoomDisallowRuleReminder,
  mockVisualNetworkDependencies,
} from './networkMocks';

export const AUTH_STATE_PATH = path.resolve(__dirname, '..', '..', 'auth-state.json');

type AuthStateArgs = {
  entries: Record<string, string>;
  langKey: string;
  countryKey: string;
  countryCode: string;
};

/**
 * 在应用初始化前写入共享认证缓存，保留场景语言并固定国家码。
 * @param args - 包含 entries 缓存、语言键 langKey、国家码键 countryKey 和固定区号 countryCode 的注入配置。
 */
function injectAuthState(args: AuthStateArgs): void {
  const { entries, langKey, countryKey, countryCode } = args;
  Object.entries(entries).forEach(([key, value]) => {
    if (key !== langKey) {
      window.localStorage.setItem(key, value);
    }
  });
  window.localStorage.setItem(countryKey, countryCode);
}

/**
 * 构建浏览器初始化脚本所需的认证缓存和存储键参数。
 * @param entries - 待注入或保存的 localStorage 键值。
 */
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
    // 登录态文件不存在或损坏时，交由场景报告失败。
  }
  return null;
}
/**
 * 将 Chromium 的 `en-US@posix` 语言值规范化，避免 Intl 或 react-native-localize 抛错。
 * @param context - 首次导航前配置的浏览器上下文。
 */
export async function fixNavigatorLanguage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'language', {
        /** 返回固定浏览器语言值，避免平台语言后缀影响国际化组件。 */
        get() { return 'en-US'; },
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        /** 返回固定浏览器语言值，避免平台语言后缀影响国际化组件。 */
        get() { return ['en-US', 'en']; },
        configurable: true,
      });
    } catch {
      // 浏览器不允许覆盖语言属性时继续使用默认值。
    }
  });
}

/**
 * 禁用动画：
 * - CSS animation/transition（配合 toHaveScreenshot 的 animations: 'disabled'）
 * - 标记 __VISUAL_REGRESSION__，供业务侧跳过 RN Animated / setTimeout 驱动的动效
 * （例如大厅 Slot 横幅每 4s 的 random spinTo，CSS 关不住）
 * @param context - 首次导航前配置的浏览器上下文。
 */
export async function disableAnimations(context: BrowserContext): Promise<void> {
  // 使用原始浏览器脚本，避免 tsx 为嵌套具名函数注入 __name 后无法序列化。
  await context.addInitScript(`(() => {
    globalThis.__VISUAL_REGRESSION__ = true;
    const id = 'visual-disable-animations';
    const inject = () => {
      const parent = document.head || document.documentElement;
      if (!parent || document.getElementById(id)) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = '*, *::before, *::after { animation: none !important; animation-delay: 0s !important; transition: none !important; scroll-behavior: auto !important; -webkit-font-smoothing: antialiased !important; text-rendering: geometricPrecision !important; }';
      parent.appendChild(style);
    };
    inject();
    document.addEventListener('DOMContentLoaded', inject);
  })();`);
}

/** 采集态里与登录无关、可安全复用的缓存键（主题等；国家码已由 mockFixedCountryCode 固定） */
const SAFE_CACHE_KEYS = ['app.theme.id.key'];

/**
 * 在 BrowserContext 创建阶段预置 localStorage，确保早于应用 bundle 初始化
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param baseUrl - 应用入口，用于确定 localStorage 所属来源。
 */
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

/**
 * 在首次导航前配置场景语言、设备标识、认证缓存和网络依赖。
 * @param context - 首次导航前配置的浏览器上下文。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param page - 执行操作的 Playwright 页面。
 * @param options - useMitmproxy 指定是否由专用代理处理网络依赖。
 */
export async function setupContextForScenario(
  context: BrowserContext,
  scenario: VisualScenario,
  page?: Page,
  options: { useMitmproxy?: boolean } = {},
): Promise<void> {
  await fixNavigatorLanguage(context);
  await disableAnimations(context);
  await mockVisualNetworkDependencies(context, {
    realPrivateRoom: scenario.group === 'texas-holdem' || scenario.group === 'zhajinhua',
    useMitmproxy: options.useMitmproxy,
    recordFixtures: scenario.group === 'game-record',
  });
  if (scenario.pageLabel === 'signed_in_daily_bonus') await mockDailyBonusWallet(context);

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
