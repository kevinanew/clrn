/**
 * 场景级 context 设置：
 * 语言/deviceId、真实登录态恢复、具名代理场景。
 * 必须在 page.goto 之前调用。
 */

import type { BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LANGUAGE_STORAGE_KEY, type VisualScenario } from '../../scenarioTypes';
import { scenarioProxy, selectScenario } from '../../../e2e/helpers/scenario-proxy';

// 独立动画运行可使用临时认证文件，避免与其他套件相互覆盖。
export const AUTH_STATE_PATH = process.env.VISUAL_AUTH_STATE_PATH
  ? path.resolve(process.env.VISUAL_AUTH_STATE_PATH)
  : path.resolve(__dirname, '..', '..', 'auth-state.json');

type AuthStateArgs = {
  entries: Record<string, string>;
  langKey: string;
};

/**
 * 在应用初始化前写入共享认证缓存，保留场景语言。
 * @param args - 已采集的真实认证缓存及需要保留的场景语言键。
 */
function injectAuthState(args: AuthStateArgs): void {
  const { entries, langKey } = args;
  Object.entries(entries).forEach(/** 注入保存的登录态存储项，同时保留本次场景选择的语言。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ([key, value]) => {
    if (key !== langKey) {
      window.localStorage.setItem(key, value);
    }
  });
}

/**
 * 构建浏览器初始化脚本所需的认证缓存和存储键参数。
 * @param entries - 待注入或保存的 localStorage 键值。
 */
function buildAuthStateArgs(entries: Record<string, string>): AuthStateArgs {
  return {
    entries,
    langKey: LANGUAGE_STORAGE_KEY,
  };
}

/** 读取本次运行采集的登录态；不存在/损坏时返回 null，由场景明确失败。 */
export function readAuthStateEntries(): Record<string, string> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const entries = authEntriesField(raw);
    if (hasAuthEntries(entries)) {
      return entries as Record<string, string>;
    }
  } catch {
    // 登录态文件不存在或损坏时，交由场景报告失败。
  }
  return null;
}
/** 验证缓存是非空对象，保留损坏文件的回退语义。
 * @param entries - 文件中的认证条目。 */
function hasAuthEntries(entries: unknown): boolean {
  if (!entries || typeof entries !== 'object') return false;
  return Object.keys(entries).length > 0;
}

/** 仅复制允许跨未登录场景复用的缓存。
 * @param entries - 已采集的认证缓存。 */
function safeCacheEntries(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(SAFE_CACHE_KEYS.filter(/** 不复制缺失的键。
   * @param key - 白名单键。 */ key => entries[key] !== undefined).map(/** 保留真实缓存值。
   * @param key - 白名单键。 */ key => [key, entries[key]]));
}

/** 根据场景身份选择认证缓存或安全缓存。
 * @param signIn - 是否需要登录态。
 * @param entries - 采集缓存，可能缺失。 */
function scenarioCacheEntries(signIn: boolean, entries: Record<string, string> | null): Record<string, string> {
  if (!entries) return {};
  return signIn ? entries : safeCacheEntries(entries);
}

/**
 * 将 Chromium 的 `en-US@posix` 语言值规范化，避免 Intl 或 react-native-localize 抛错。
 * @param context - 首次导航前配置的浏览器上下文。
 * @param locale - 浏览器语言，启动品牌按系统语言显示，缺省沿用英语。
 */
export async function fixNavigatorLanguage(context: BrowserContext, locale = 'en-US'): Promise<void> {
  await context.addInitScript(/** 固定 navigator 的单语言及语言列表，避免平台语言后缀改变界面。
 * @param language - 当前操作使用的 language。 */ (language: string) => {
    try {
      Object.defineProperty(Navigator.prototype, 'language', {
        /** 返回固定浏览器语言值，避免平台语言后缀影响国际化组件。 */
        get() { return language; },
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        /** 返回固定浏览器语言值，避免平台语言后缀影响国际化组件。 */
        get() { return [language, language.split('-')[0]]; },
        configurable: true,
      });
    } catch {
      // 浏览器不允许覆盖语言属性时继续使用默认值。
    }
  }, locale);
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

/** 采集态里与登录无关、可安全复用的缓存键（主题等） */
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

  Object.assign(entries, scenarioCacheEntries(scenario.signIn, authEntries));

  Object.assign(entries, {
    [LANGUAGE_STORAGE_KEY]: scenario.locale,
    deviceId: scenario.deviceId,
  });

  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseUrl).origin,
        localStorage: Object.entries(entries).map(/** 将当前条目映射为`{ name, value }`。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ([name, value]) => ({ name, value })),
      },
    ],
  };
}

/**
 * 在首次导航前配置场景语言、设备标识、认证缓存和网络依赖。
 * @param context - 首次导航前配置的浏览器上下文。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param page - 执行操作的 Playwright 页面。
 * @param options - 指定代理处理的请求、应用动效和系统语言。
 */
export async function setupContextForScenario(
  context: BrowserContext,
  scenario: VisualScenario,
  page?: Page,
  options: { animations?: 'allow' | 'disabled'; navigatorLocale?: string } = {},
): Promise<void> {
  await fixNavigatorLanguage(context, options.navigatorLocale);
  await configureAnimations(context, options.animations);
  await scenarioProxy(context).command('fixtures/environment', { visual: true });
  const authEntries = readAuthStateEntries();
  await configureScenarioProxy(context, scenario, authEntries);

  await context.addInitScript(
    /** 在新上下文中写入场景语言和固定设备 ID，稳定启动导航。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ locale, langKey, deviceId }: { locale: string; langKey: string; deviceId: string }) => {
      window.localStorage.setItem(langKey, locale);
      // 固定 deviceId（所有场景，含未登录）：随机 deviceId 会让启动期设备注册
      // 回调在点击后触发导航重置，杀掉刚打开的登录 modal
      window.localStorage.setItem('deviceId', deviceId);
    },
    { locale: scenario.locale, langKey: LANGUAGE_STORAGE_KEY, deviceId: scenario.deviceId },
  );

  await injectScenarioCache(context, scenario, authEntries, page);
}

/** 应用显式动画选项。
 * @param context - 当前上下文。
 * @param animations - 场景动画模式。 */
async function configureAnimations(context: BrowserContext, animations: 'allow' | 'disabled' | undefined): Promise<void> {
  if (animations !== 'allow') await disableAnimations(context);
}

/** 从认证缓存读取代理场景账户参数，缺失时仍使用空参数。
 * @param entries - 采集认证缓存。 */
function scenarioUser(entries: Record<string, string> | null): { userId?: string } {
  const raw = entries?.['save.user.origin.data.from.server.key'] || '{}';
  return scenarioUserPayload(JSON.parse(raw).user_id);
}

/** 保留代理账户参数的真值选择规则。
 * @param userId - 原始缓存用户 ID。 */
function scenarioUserPayload(userId: string | undefined): { userId?: string } {
  return userId ? { userId } : {};
}

/** 仅为具名页面选择网络夹具，其余保持默认透传。
 * @param context - 当前上下文。
 * @param scenario - 视觉场景。
 * @param authEntries - 本轮认证缓存。 */
async function configureScenarioProxy(context: BrowserContext, scenario: VisualScenario, authEntries: Record<string, string> | null): Promise<void> {
  const scenes: Record<string, string> = {
    signed_in_daily_bonus: 'daily-bonus', signed_in_club: 'club-empty',
    signed_in_club_rooms: 'club-empty', signed_in_club_more: 'club-empty',
    signed_in_club_search: 'club-empty', signed_in_mall: 'mall',
    signed_in_currency_transaction: 'wallet-populated',
    signed_in_currency_transaction_diamond: 'wallet-populated',
  };
  if (scenes[scenario.pageLabel]) {
    await selectScenario(context, scenes[scenario.pageLabel], scenarioUser(authEntries));
  }

}

/** 根据身份注入缓存，缺失缓存时由后续认证校验明确失败。
 * @param context - 当前上下文。
 * @param scenario - 视觉场景。
 * @param authEntries - 本轮采集缓存。
 * @param page - 已创建的页面。 */
async function injectScenarioCache(context: BrowserContext, scenario: VisualScenario,
  authEntries: Record<string, string> | null, page: Page | undefined): Promise<void> {
  if (!authEntries) return;
  if (scenario.signIn) return injectSignedInCache(context, authEntries, page);
  await injectGuestCache(context, authEntries);
}

/** 同时覆盖上下文和已存在页面的下一次导航。
 * @param context - 当前上下文。
 * @param entries - 完整认证缓存。
 * @param page - 已创建的页面。 */
async function injectSignedInCache(context: BrowserContext, entries: Record<string, string>, page: Page | undefined): Promise<void> {
  const args = buildAuthStateArgs(entries);
  await context.addInitScript(injectAuthState, args);
  if (page) await page.addInitScript(injectAuthState, args);
}

/** 只在存在白名单缓存时为游客注册初始化脚本。
 * @param context - 当前上下文。
 * @param entries - 认证缓存。 */
async function injectGuestCache(context: BrowserContext, entries: Record<string, string>): Promise<void> {
  const safeEntries = safeCacheEntries(entries);
  if (Object.keys(safeEntries).length > 0) await context.addInitScript(injectAuthState, buildAuthStateArgs(safeEntries));
}

/** 安全读取认证文件的条目字段。
 * @param raw - 解析后的文件内容。 */
function authEntriesField(raw: any): unknown { return raw?.entries; }
