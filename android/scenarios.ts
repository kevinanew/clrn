import { buildScenarios, type VisualScenario } from '../visual/scenarios';
import type { AndroidSelector } from 'playwright';

// 当前 Staging APK 使用 default 发布渠道；原生 SettingItems 仅对 self-host 显示下载帮助。
// 保留显式清单以记录平台差异，不把不可达页面算作已执行覆盖。
export const unavailablePages = [
  'signed_in_download_help', 'signed_in_download_help_apple', 'signed_in_download_help_android',
  'signed_in_download_help_h5', 'signed_in_download_help_official',
] as const;

/**
 * 将共享页面清单中的 testID 选择器映射到原生控件；拒绝悄悄忽略复杂 CSS。
 * @param selector - Web 场景的就绪或消失选择器。
 */
export function nativeSelector(selector: string): AndroidSelector {
  const match = /^\[data-testid(\^=|\$=|=)"([^"]+)"\](?: input)?$/.exec(selector);
  if (!match) throw new Error(`原生端需要显式适配选择器：${selector}`);
  const [, operator, value] = match;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { res: operator === '=' ? value : new RegExp(operator === '^=' ? `^${escaped}.*` : `.*${escaped}$`) };
}

/**
 * 使用 Web 的同一份手机场景清单；桌面留白不产生额外安卓场景。
 * @param locale - 本轮应用语言。
 * @param group - 本轮独立运行的业务组。
 */
export function androidScenarios(locale: string, group = 'all'): VisualScenario[] {
  if (!['all', 'guest', 'account', 'social', 'rooms', 'wallet-help', 'records', 'texas', 'zhajinhua'].includes(group)) throw new Error(`未知安卓业务组：${group}`);
  return buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: 'app' })
    .filter(scenario => scenario.viewport.label === 'mobile' && scenario.group !== 'game-record')
    .filter(scenario => !unavailablePages.some(page => page === scenario.pageLabel))
    .filter(scenario => {
      const selected = !scenario.signIn ? 'guest' : scenario.group === 'account' ? 'account'
        : scenario.group === 'private-room' ? 'rooms' : ['wallet', 'help'].includes(scenario.group) ? 'wallet-help' : 'social';
      return group === 'all' || group === selected;
    });
}
