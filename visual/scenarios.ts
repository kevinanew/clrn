export * from './scenarioTypes';
import {
  PAGES,
  SEARCH_SIGN_IN_PROMPT_SCENARIO,
  GUEST_GAME_SIGN_IN_PROMPT_SCENARIO,
} from './cases/hall/guest';
import { GUEST_CLUB_SCENARIO } from './cases/club/guest';
import {
  LOGIN_OPEN_SCENARIO,
  LOGIN_USERNAME_SCENARIO,
} from './cases/auth/scenarios';
export * from './cases/hall/guest';
export * from './cases/club/guest';
export * from './cases/auth/scenarios';
import {
  LOCALES,
  VIEWPORTS,
  VISUAL_DEVICE_ID,
  type LocaleCode,
  type LocaleDef,
  type PageDef,
  type ScenarioGroup,
  type SignedInPageDef,
  type ViewportDef,
  type ViewportLabel,
  type VisualScenario,
} from './scenarioTypes';
import { pages as hallPages } from './cases/hall/scenarios';
import { pages as messagePages } from './cases/message/scenarios';
import { pages as private_roomPages } from './cases/private-room/scenarios';
import { pages as texasHoldemPages } from './cases/texas-holdem/scenarios';
import { pages as zhajinhuaPages } from './cases/zhajinhua/scenarios';
import { pages as clubPages } from './cases/club/scenarios';
import { pages as accountPages } from './cases/account/scenarios';
import { pages as walletPages } from './cases/wallet/scenarios';
import { pages as gameRecordPages } from './cases/game-record/scenarios';
import { pages as helpPages } from './cases/help/scenarios';
import { getVisualSuite, selectVisualSuite } from './visual-suite';

import { CORE_PAGE_LABELS, mobileLoginSideScenarios } from './scenarioScope';
export { CORE_PAGE_LABELS } from './scenarioScope';

/**
 * 为一组页面定义统一添加场景分类。
 * @param group - 该组页面所属的场景分类。
 * @param pages - 待处理的页面定义或截图元数据清单。 */
function withGroup(group: ScenarioGroup, pages: SignedInPageDef[]): GroupedPageDef[] {
  return pages.map(/** 给页面定义补上所属分组，供场景生成与套件筛选。
 * @param page - 当前 Playwright 页面。 */ page => ({ ...page, group }));
}

type GroupedPageDef = SignedInPageDef & { group: ScenarioGroup };

/** Page definitions live beside their tests and baseline screenshots. */
export const SIGNED_IN_PAGES: GroupedPageDef[] = [
  ...withGroup('hall', hallPages),
  ...withGroup('message', messagePages),
  ...withGroup('private-room', private_roomPages),
  ...withGroup('texas-holdem', texasHoldemPages),
  ...withGroup('zhajinhua', zhajinhuaPages),
  ...withGroup('club', clubPages),
  ...withGroup('account', accountPages),
  ...withGroup('wallet', walletPages),
  ...withGroup('game-record', gameRecordPages),
  ...withGroup('help', helpPages),
];

/** 解析语言筛选配置，拒绝不支持的语言代码。
 * @param raw - 原始语言筛选配置。 */
function parseLocaleFilter(raw: string | undefined): LocaleCode[] | 'all' {
  const value = localeFilterValue(raw);
  if (['', 'all'].includes(value)) {
    return 'all';
  }

  const allowed = new Set(LOCALES.map(/** 收集允许的语言代码，校验视觉运行的语言选择。
 * @param locale - 当前测试使用的语言。 */ (locale) => locale.code));
  const selected = value
    .split(',')
    .map(/** 移除语言选项两侧空白，允许逗号分隔配置带空格。
 * @param item - 当前遍历的条目。 */ (item) => item.trim())
    .filter(/** 只保留已支持的语言代码，供后续无效配置检测。
 * @param item - 当前遍历的条目。 */ (item): item is LocaleCode => allowed.has(item as LocaleCode));

  if (selected.length === 0) {
    throw new Error(
      `VISUAL_LOCALES 无效: "${raw}"。可用值: ${LOCALES.map(/** 列出允许的语言代码，形成无效语言配置的错误提示。
 * @param l - 当前操作使用的 l。 */ (l) => l.code).join(', ')}, all`,
    );
  }

  return selected;
}

/**
 * 空环境值沿用简体默认值，纯空白值仍选择全部语言。
 * @param raw - 原始语言配置。
 */
function localeFilterValue(raw: string | undefined): string {
  return (raw || 'zh-Hans').trim();
}

/**
 * 根据环境配置选出本轮使用的语言，支持全量语言模式。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getActiveLocales(env: NodeJS.ProcessEnv = process.env): LocaleDef[] {
  const filter = parseLocaleFilter(env.VISUAL_LOCALES);
  if (filter === 'all') {
    return LOCALES;
  }
  return LOCALES.filter(/** 按语言筛选配置保留本轮应执行的语言。
 * @param locale - 当前测试使用的语言。 */ (locale) => filter.includes(locale.code));
}

/** 场景 label：`{locale}_{viewport}_{page}`，便于在目录与 HTML 报告中按「语言 → 视口」分组。 例：`zh-Hans_desktop_hall`、`zh-Hans_mobile_signed_in_me`
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param pageLabel - 页面定义中的场景标签。
 * @param suffix - 需要追加到场景标签的可选后缀。 */
export function scenarioLabel(
  locale: LocaleDef,
  viewport: ViewportDef,
  pageLabel: string,
  suffix = '',
): string {
  const base = `${locale.code}_${viewport.label}_${pageLabel}`;
  return suffix ? `${base}_${suffix}` : base;
}

/** 合并页面、语言、视口与覆盖选项，生成一个完整视觉场景。
 * @param page - 待展开的页面定义。
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param overrides - 覆盖页面默认设置的场景选项。 */
function buildScenario(
  page: PageDef,
  locale: LocaleDef,
  viewport: ViewportDef,
  overrides: Partial<VisualScenario> & { label?: string; pageLabel?: string } = {},
): VisualScenario {
  return {
    label: scenarioLabel(locale, viewport, page.label),
    group: 'hall',
    path: page.path,
    pageLabel: page.label,
    locale: locale.code,
    viewport,
    readyText: page.readyText?.[locale.code],
    visualReadySelector: page.visualReadySelector,
    signIn: false,
    deviceId: VISUAL_DEVICE_ID,
    tabTestId: '',
    navClickTestIds: [],
    waitForLoading: true,
    fixedTexts: [],
    hideSelectors: [],
    ...overrides,
  };
}

/** 单个「语言 × 视口」下的全部页面场景（大厅 → 登录页 → 登录后 tabs）
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。 */
function buildLocaleViewportScenarios(locale: LocaleDef, viewport: ViewportDef): VisualScenario[] {
  const hallPage = PAGES.find(/** 定位大厅页面定义，生成依赖大厅入口的派生场景。
 * @param item - 当前遍历的条目。 */ (item) => item.label === 'hall');
  if (!hallPage) {
    throw new Error('缺少 hall 页面配置');
  }

  const scenarios: VisualScenario[] = [buildScenario(hallPage, locale, viewport)];

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel),
      pageLabel: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel,
      navClickTestIds: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.navClickTestIds,
      visualReadySelector: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      readyText: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.readyText[locale.code],
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'guest_private_room'),
      group: 'private-room',
      pageLabel: 'guest_private_room',
      tabTestId: 'private-room-tab',
      visualReadySelector: '[data-testid="guest-private-room-empty-state"]',
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login'),
      group: 'auth',
      pageLabel: 'login',
      navClickTestIds: LOGIN_OPEN_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_OPEN_SCENARIO.visualReadySelector,
      readyText: LOGIN_OPEN_SCENARIO.readyText[locale.code],
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login_username'),
      group: 'auth',
      pageLabel: 'login_username',
      navClickTestIds: LOGIN_USERNAME_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_USERNAME_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, GUEST_CLUB_SCENARIO.pageLabel),
      group: 'club',
      pageLabel: GUEST_CLUB_SCENARIO.pageLabel,
      navClickTestIds: GUEST_CLUB_SCENARIO.navClickTestIds,
      visualReadySelector: GUEST_CLUB_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel),
      pageLabel: SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel,
      navClickTestIds: SEARCH_SIGN_IN_PROMPT_SCENARIO.navClickTestIds,
      visualReadySelector: SEARCH_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  appendMobileLoginScenarios(scenarios, hallPage, locale, viewport);

  for (const [pageLabel, tabTestId, readyId, group] of [
    ['guest_message', 'message-tab', 'not-sign-in-container', 'message'],
    ['guest_me', 'settings-tab', 'after-sign-in-see-asset-text', 'account'],
  ] as const) {
    scenarios.push(buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, pageLabel),
      group,
      pageLabel,
      tabTestId,
      visualReadySelector: `[data-testid="${readyId}"]`,
      readyText: undefined,
    }));
  }

  const signedInPages = SIGNED_IN_PAGES.filter(/** 根据当前条目计算结果。
 * @param page - 当前回调参数。 */ page => supportsViewport(page, viewport.label));
  scenarios.push(...signedInPages.map(/** 根据当前条目计算结果。
 * @param page - 当前回调参数。 */ page => buildSignedInScenario(page, hallPage, locale, viewport)));

  ['launch_staging_notice', 'launch_branding'].forEach(/** 执行当前测试或处理逻辑。
 * @param pageLabel - 当前回调参数。 */ pageLabel => {
    scenarios.push(buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, pageLabel), group: 'launch', pageLabel,
      visualReadySelector: '[data-testid="launch-screen-container"]', readyText: undefined,
    }));
  });
  return scenarios;
}

/**
 * 添加仅在手机视口展示的静态登录支线。
 * @param scenarios - 按导航顺序追加的场景。
 * @param hallPage - 大厅页面定义。
 * @param locale - 场景语言。
 * @param viewport - 当前视口。
 */
function appendMobileLoginScenarios(scenarios: VisualScenario[], hallPage: PageDef, locale: LocaleDef, viewport: ViewportDef): void {
  if (viewport.label === 'mobile') {
    for (const sideScenario of mobileLoginSideScenarios()) {
      scenarios.push(
        buildScenario(hallPage, locale, viewport, {
          label: scenarioLabel(locale, viewport, sideScenario.labelSuffix),
          group: 'auth',
          pageLabel: sideScenario.labelSuffix,
          navClickTestIds: sideScenario.navClickTestIds,
          visualReadySelector: sideScenario.visualReadySelector,
          readyText: undefined,
        }),
      );
    }
  }
}

/**
 * 判断页面允许的视口，未限定时覆盖全部视口。
 * @param page - 登录后页面。
 * @param viewportLabel - 当前视口名称。
 */
function supportsViewport(page: SignedInPageDef, viewportLabel: ViewportLabel): boolean {
  return !page.viewports || page.viewports.includes(viewportLabel);
}

/**
 * 补齐登录页面的导航和固定文本默认值。
 * @param page - 登录后页面。
 */
function signedInNavigation(page: SignedInPageDef) {
  return { navClickTestIds: page.navClickTestIds ?? [], fixedTexts: page.fixedTexts ?? [] };
}

/**
 * 未配置隐藏节点时保持空列表。
 * @param page - 登录后页面。
 */
function hiddenSelectors(page: SignedInPageDef): string[] {
  return page.hideSelectors ?? [];
}

/**
 * 展开一个已登录页面，保留选择器、快照状态和稳定化规则。
 * @param signedInPage - 带分类的登录页面。
 * @param hallPage - 大厅页面定义。
 * @param locale - 场景语言。
 * @param viewport - 当前视口。
 */
function buildSignedInScenario(signedInPage: GroupedPageDef, hallPage: PageDef, locale: LocaleDef, viewport: ViewportDef): VisualScenario {
  const navigation = signedInNavigation(signedInPage);
  return buildScenario(hallPage, locale, viewport, {
    label: scenarioLabel(locale, viewport, signedInPage.label),
    group: signedInPage.group,
    pageLabel: signedInPage.label,
    signIn: true,
    tabTestId: signedInPage.tabTestId,
    navClickTestIds: navigation.navClickTestIds,
    fixedTexts: navigation.fixedTexts,
    hideSelectors: hiddenSelectors(signedInPage),
    snapshotStates: signedInPage.snapshotStates,
    visualReadySelector: signedInPage.visualReadySelector,
    resetScrollSelector: signedInPage.resetScrollSelector,
    visualGoneSelector: signedInPage.visualGoneSelector,
    // 登录后页面用选择器判定就绪，不再依赖大厅未登录文案
    readyText: undefined,
  });
}

/** 根据语言、范围和套件环境配置构建本轮视觉场景清单。
 * @param env - 环境配置，默认读取当前进程。 */
export function buildScenarios(env: NodeJS.ProcessEnv = process.env): VisualScenario[] {
  const suite = getVisualSuite(env);
  const locales = getActiveLocales(env);
  const scenarios = locales.flatMap(/** 展开当前条目对应的`VIEWPORTS.flatMap((viewport) => buildLocaleViewportScenarios(locale, viewport))`。
 * @param locale - 当前测试使用的语言。 */ (locale) =>
    VIEWPORTS.flatMap(/** 展开当前条目对应的`buildLocaleViewportScenarios(locale, viewport)`。
 * @param viewport - 当前操作使用的 viewport。 */ (viewport) => buildLocaleViewportScenarios(locale, viewport)),
  );

  const scopedScenarios = env.VISUAL_SCOPE === 'core'
    ? scenarios.filter(/** 只保留核心页面场景，构造核心视觉回归集合。
 * @param scenario - 当前测试场景配置。 */ scenario => CORE_PAGE_LABELS.has(scenario.pageLabel))
    : scenarios;
  return selectVisualSuite(scopedScenarios, suite);
}

/** 指定视口下的页面数（登录支线与部分静态子页仅 mobile）
 * @param viewportLabel - 要统计的视口名称。 */
export function pageCountForViewport(viewportLabel: ViewportLabel): number {
  // 游客主页面 9 页及启动页 2 页；登录支线 9 页仅 mobile。
  const unauthenticated = viewportLabel === 'mobile' ? 20 : 11;
  const signedIn = SIGNED_IN_PAGES.filter(
    /** 根据当前条目计算结果。
 * @param page - 当前回调参数。 */ (page) => supportsViewport(page, viewportLabel),
  ).length;
  return unauthenticated + signedIn;
}

/** 计算当前语言和范围配置应产生的视觉场景总数。
 * @param env - 环境配置，默认读取当前进程。 */
export function expectedScenarioCount(env: NodeJS.ProcessEnv = process.env): number {
  return buildScenarios(env).length;
}
