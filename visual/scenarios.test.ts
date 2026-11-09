/** 验证视觉场景的语言、视口、数量和导航覆盖。 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  buildScenarios,
  CORE_PAGE_LABELS,
  expectedScenarioCount,
  GUEST_CLUB_SCENARIO,
  GUEST_GAME_SIGN_IN_PROMPT_SCENARIO,
  getActiveLocales,
  LOCALES,
  LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
  LOGIN_OPEN_SCENARIO,
  LOGIN_USERNAME_SCENARIO,
  pageCountForViewport,
  SEARCH_SIGN_IN_PROMPT_SCENARIO,
  SIGNED_IN_PAGES,
  scenarioLabel,
  VIEWPORTS,
} from './scenarios';

describe('visual scenarios', /** 核对视觉场景的语言、视口与页面就绪约定。 */ () => {
  const originalLocales = process.env.VISUAL_LOCALES;
  const originalScope = process.env.VISUAL_SCOPE;

  // CI 使用完整场景；单测默认检查全量矩阵，需要核心范围时在用例内显式设置。
  beforeEach(/** 每个场景生成测试前清除范围过滤。 */ () => {
    delete process.env.VISUAL_SCOPE;
  });

  afterEach(/** 恢复场景生成测试修改的语言和范围环境变量。 */ () => {
    for (const [key, value] of [['VISUAL_LOCALES', originalLocales], ['VISUAL_SCOPE', originalScope]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** 统计一个语言在全部视口下应生成的场景数。 */
  const pagesPerLocale = () =>
    VIEWPORTS.reduce(/** 累计各视口核心场景的预期数量。
 * @param sum - 当前操作使用的 sum。
 * @param viewport - 当前操作使用的 viewport。 */ (sum, viewport) => sum + pageCountForViewport(viewport.label), 0);
  test('默认 VISUAL_LOCALES 仅简体中文', /** 验证默认 VISUAL_LOCALES 仅简体中文。 */ () => {
    delete process.env.VISUAL_LOCALES;
    const scenarios = buildScenarios();
    assert.deepEqual(getActiveLocales(), [LOCALES[0]]);
    assert.equal(scenarios.length, pagesPerLocale());
    assert.equal(expectedScenarioCount(), pagesPerLocale());
  });

  test('VISUAL_LOCALES=all 覆盖全部语言与视口', /** 验证VISUAL_LOCALES=all 覆盖全部语言与视口。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, LOCALES.length * pagesPerLocale());
    assert.equal(expectedScenarioCount(), LOCALES.length * pagesPerLocale());
  });

  test('VISUAL_SCOPE=core 仅保留核心页面子集', /** 验证VISUAL_SCOPE=core 仅保留核心页面子集。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    process.env.VISUAL_SCOPE = 'core';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, 74);
    assert.equal(expectedScenarioCount(), 74);
    assert.equal(scenarios.filter(/** 统计移动视口场景，核对移动端矩阵覆盖。
 * @param s - 当前操作使用的 s。 */ s => s.viewport.label === 'mobile').length, 40);
    assert.equal(scenarios.filter(/** 统计桌面视口场景，核对桌面端矩阵覆盖。
 * @param s - 当前操作使用的 s。 */ s => s.viewport.label === 'desktop').length, 34);
    scenarios.forEach(/** 确认收集的场景仅包含允许的核心页面。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.ok(CORE_PAGE_LABELS.has(scenario.pageLabel));
    });
  });

  test('VISUAL_SCOPE=full 在简中生成全部 141 个场景', /** 验证VISUAL_SCOPE=full 在简中生成全部 141 个场景。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 141);
    assert.equal(expectedScenarioCount(), 141);
  });

  test('未设置 VISUAL_SCOPE 时在简中默认生成全部 141 个场景', /** 验证未设置 VISUAL_SCOPE 时在简中默认生成全部 141 个场景。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    delete process.env.VISUAL_SCOPE;
    assert.equal(buildScenarios().length, 141);
    assert.equal(expectedScenarioCount(), 141);
  });

  test('VISUAL_LOCALES=all VISUAL_SCOPE=full 生成 423 个场景', /** 验证VISUAL_LOCALES=all VISUAL_SCOPE=full 生成 423 个场景。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 423);
    assert.equal(expectedScenarioCount(), 423);
  });

  test('新增业务页面有对应导航与就绪定位，签到日期固定且不提交业务', /** 验证新增业务页面有对应导航与就绪定位，签到日期固定且不提交业务。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    LOCALES.forEach(/** 执行当前测试或处理逻辑。
 * @param locale - 当前回调参数。 */ locale => {
      for (const label of ['guest_message', 'guest_me', 'login_language', 'login_phone_password',
        'signed_in_slot', 'signed_in_daily_bonus', 'signed_in_hall_search',
        'signed_in_create_room_advanced_texas', 'signed_in_create_room_advanced_zhajinhua',
        'signed_in_create_room_advanced_six_plus']) {
        const scenario = scenarios.find(/** 按语言、移动视口与页面名定位预期场景。
 * @param s - 当前操作使用的 s。 */ s => s.locale === locale.code && s.viewport.label === 'mobile'
          && s.pageLabel === label);
        assert.ok(scenario, `${locale.code}/${label} 应纳入截图清单`);
        assert.ok(scenario.visualReadySelector);
        assert.equal(scenario.signIn, label.startsWith('signed_in_'));
        assert.ok(!scenario.navClickTestIds.includes('spin-button'), '截图不能发起抽奖');
        assert.ok(!scenario.navClickTestIds.includes('daily-bonus-check-in'), '截图不能领取奖励');
      }
    });
    const bonus = SIGNED_IN_PAGES.find(/** 定位每日奖励页面定义，检查视口与入口配置。
 * @param page - 当前 Playwright 页面。 */ page => page.label === 'signed_in_daily_bonus');
    assert.deepEqual(bonus?.fixedTexts, [{
      selector: '[data-testid="CheckInDateListItem.checkInDetailDate"]', text: '01/01',
    }]);
    assert.equal(new Set(scenarios.map(/** 将场景标签转换为文件名形式，检查截图命名冲突。
 * @param s - 当前操作使用的 s。 */ s => s.label.replace(/_/g, '-'))).size, scenarios.length,
      'Playwright 清洗后的截图文件名也必须唯一');
  });

  test('静态子页仅覆盖 mobile 视口', /** 验证静态子页仅覆盖 mobile 视口。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const mobileOnlyPages = SIGNED_IN_PAGES.filter(/** 选取限制视口的页面，核对场景生成遵守视口约束。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => pageDef.viewports);
    assert.ok(mobileOnlyPages.length > 0);
    mobileOnlyPages.forEach(/** 核对仅支持移动端的页面按其声明生成场景。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => {
      const matched = scenarios.filter(/** 按页面标识收集场景，检查视口筛选结果。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageDef.label);
      assert.equal(matched.length, pageDef.viewports!.length, pageDef.label);
      matched.forEach(/** 确认当前场景视口属于页面声明的支持范围。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
        assert.ok(pageDef.viewports!.includes(scenario.viewport.label));
      });
    });
  });

  test('场景按语言 → 视口 → 页面顺序排列', /** 验证场景按语言 → 视口 → 页面顺序排列。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    const expectedOrder = LOCALES.flatMap(/** 展开当前条目对应的`VIEWPORTS.map((viewport) => ${locale.code}_${viewport.label})`。
 * @param locale - 当前测试使用的语言。 */ (locale) =>
      VIEWPORTS.map(/** 生成预期的语言与视口组合标识。
 * @param viewport - 当前操作使用的 viewport。 */ (viewport) => `${locale.code}_${viewport.label}`),
    );
    const actualOrder = [
      ...new Set(scenarios.map(/** 提取实际场景的语言与视口组合，核对覆盖矩阵。
 * @param scenario - 当前测试场景配置。 */ (scenario) => `${scenario.locale}_${scenario.viewport.label}`)),
    ];
    assert.deepEqual(actualOrder, expectedOrder);

    // 同一语言×视口内：大厅 → 游客牌局登录提示 → 游客私人房 → 登录首页 → 用户名登录页 → 游客俱乐部 → 登录后页面
    const zhDesktop = scenarios.filter(
      /** 选取简体中文桌面场景，检查该组合下的页面集合。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.locale === 'zh-Hans' && scenario.viewport.label === 'desktop',
    );
    assert.ok(zhDesktop.length >= 9);
    assert.equal(zhDesktop[0].label, 'zh-Hans_desktop_hall');
    assert.equal(zhDesktop[1].label, 'zh-Hans_desktop_guest_game_sign_in_prompt');
    assert.equal(zhDesktop[2].label, 'zh-Hans_desktop_guest_private_room');
    assert.equal(zhDesktop[3].label, 'zh-Hans_desktop_login');
    assert.equal(zhDesktop[4].label, 'zh-Hans_desktop_login_username');
    assert.equal(zhDesktop[5].label, 'zh-Hans_desktop_guest_club');
    assert.equal(zhDesktop[6].label, 'zh-Hans_desktop_search_sign_in_prompt');
    // 忘记密码相关页仅 mobile，desktop 随后进入登录后页面
    assert.equal(zhDesktop[7].label, 'zh-Hans_desktop_guest_message');
    assert.equal(zhDesktop[8].label, 'zh-Hans_desktop_guest_me');
    assert.ok(zhDesktop.some(/** 根据当前条目计算结果。
 * @param scenario - 当前回调参数。 */ scenario => scenario.pageLabel === 'signed_in_hall'));
  });

  test('每个场景都包含语言标识与就绪条件，label 为 locale_viewport_page', /** 验证每个场景都包含语言标识与就绪条件，label 为 locale_viewport_page。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    scenarios.forEach(/** 核对场景语言、标签、视口及就绪条件的完整性。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.match(scenario.locale, /^(zh-Hans|zh-Hant|en)$/);
      assert.ok(scenario.label.startsWith(`${scenario.locale}_`));
      assert.ok(scenario.label.includes(`_${scenario.viewport.label}_`));
      assert.ok(scenario.visualReadySelector);
    });
  });

  test('大厅场景覆盖各语言 desktop/mobile', /** 验证大厅场景覆盖各语言 desktop/mobile。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    LOCALES.forEach(/** 遍历全部语言，验证每种视口都有对应大厅场景。
 * @param locale - 当前测试使用的语言。 */ (locale) => {
      VIEWPORTS.forEach(/** 构造当前语言与视口的大厅标签并确认其存在。
 * @param viewport - 当前操作使用的 viewport。 */ (viewport) => {
        const label = scenarioLabel(locale, viewport, 'hall');
        assert.ok(scenarios.some(/** 按场景标签确认预期页面已进入生成结果。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === label));
      });
    });
  });

  test('未登录俱乐部场景通过底部 tab 进入且不注入登录态', /** 验证未登录俱乐部场景通过底部 tab 进入且不注入登录态。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      /** 提取游客俱乐部场景，核对游客访问配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === GUEST_CLUB_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach(/** 核对游客俱乐部场景的未登录状态与导航就绪配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, false);
      assert.equal(scenario.tabTestId, '');
      assert.deepEqual(scenario.navClickTestIds, GUEST_CLUB_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, GUEST_CLUB_SCENARIO.visualReadySelector);
    });
  });

  test('搜索登录提示场景点击大厅搜索并等待自定义确认弹窗', /** 验证搜索登录提示场景点击大厅搜索并等待自定义确认弹窗。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      /** 提取搜索登录提示场景，核对受限入口的提示配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach(/** 核对游客搜索登录提示的导航步骤与展示条件。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, false);
      assert.deepEqual(scenario.navClickTestIds, SEARCH_SIGN_IN_PROMPT_SCENARIO.navClickTestIds);
      assert.equal(
        scenario.visualReadySelector,
        SEARCH_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      );
    });
  });

  test('游客点击大厅牌局后展示登录确认弹窗', /** 验证游客点击大厅牌局后展示登录确认弹窗。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      /** 提取游客游戏登录提示场景，核对进入游戏前的登录要求。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach(/** 核对游客进入游戏触发登录提示的场景配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, false);
      assert.deepEqual(
        scenario.navClickTestIds,
        GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.navClickTestIds,
      );
      assert.equal(
        scenario.visualReadySelector,
        GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      );
      assert.equal(
        scenario.readyText,
        GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.readyText[scenario.locale],
      );
    });
  });

  test('登录大厅不依赖可选的等级接口作为就绪条件', /** 验证登录大厅不依赖可选的等级接口作为就绪条件。 */ () => {
    const scenario = buildScenarios().find(
      /** 定位简体中文桌面登录态大厅，核对首页配置。
 * @param item - 当前遍历的条目。 */ (item) =>
        item.locale === 'zh-Hans' &&
        item.viewport.label === 'desktop' &&
        item.pageLabel === 'signed_in_hall',
    );
    assert.equal(scenario?.visualReadySelector, '[data-testid="hall-shortcut-buttons-container"]');
  });

  test('游客私人房场景等待空状态引导渲染完成', /** 验证游客私人房场景等待空状态引导渲染完成。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      /** 提取游客私人房场景，核对游客入口配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'guest_private_room',
    );
    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach(/** 核对游客私人房页面的 tab 入口与空态就绪目标。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, false);
      assert.equal(scenario.tabTestId, 'private-room-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="guest-private-room-empty-state"]');
    });
  });

  test('私人房 tab 场景等待详情页房屋数据渲染完成', /** 验证私人房 tab 场景等待详情页房屋数据渲染完成。 */ () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      /** 提取已登录私人房场景，核对账号模式配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_private_room',
    );
    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach(/** 核对私人房详情页就绪目标，避免为大厅入口错误复位详情滚动。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.visualReadySelector, '[data-testid="copy-house-number-button"]');
      // 就绪目标位于详情页顶部，不应为了大厅的创建入口滚动详情页列表。
      assert.equal(scenario.resetScrollSelector, undefined);
      assert.deepEqual(scenario.navClickTestIds, []);
    });
  });

  test('登录页场景通过 navClickTestIds 打开登录首页', /** 验证登录页场景通过 navClickTestIds 打开登录首页。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const loginScenarios = scenarios.filter(/** 提取默认登录场景，核对登录入口矩阵。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label.endsWith('_login'));

    assert.equal(loginScenarios.length, 2);
    loginScenarios.forEach(/** 核对登录首页场景的入口步骤、就绪选择器和提示文本。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.deepEqual(scenario.navClickTestIds, LOGIN_OPEN_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, LOGIN_OPEN_SCENARIO.visualReadySelector);
      assert.ok(scenario.readyText);
    });
  });

  test('用户名登录页场景依次点击两级入口并等待表单', /** 验证用户名登录页场景依次点击两级入口并等待表单。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const usernameScenarios = scenarios.filter(/** 提取用户名登录场景，核对账号输入模式。
 * @param scenario - 当前测试场景配置。 */ (scenario) =>
      scenario.label.endsWith('_login_username'),
    );

    assert.equal(usernameScenarios.length, 2);
    usernameScenarios.forEach(/** 核对用户名登录场景的未登录状态与表单导航配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.deepEqual(scenario.navClickTestIds, LOGIN_USERNAME_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, LOGIN_USERNAME_SCENARIO.visualReadySelector);
      assert.equal(scenario.signIn, false);
    });
  });

  test('忘记密码邮箱表单场景仅 mobile 并等待邮箱输入框', /** 验证忘记密码邮箱表单场景仅 mobile 并等待邮箱输入框。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const emailScenarios = scenarios.filter(
      /** 提取邮箱找回密码场景，核对密码恢复页面配置。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'login_forgot_password_email',
    );

    assert.equal(emailScenarios.length, 1);
    const [emailScenario] = emailScenarios;
    assert.ok(emailScenario);
    assert.equal(emailScenario.viewport.label, 'mobile');
    assert.deepEqual(
      emailScenario.navClickTestIds,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO.navClickTestIds,
    );
    assert.equal(
      emailScenario.visualReadySelector,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO.visualReadySelector,
    );
    assert.equal(emailScenario.signIn, false);
  });

});
