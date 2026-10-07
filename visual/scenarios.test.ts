import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  BIO_INPUT_FIXED_TEXT,
  buildScenarios,
  CORE_PAGE_LABELS,
  expectedScenarioCount,
  GUEST_CLUB_SCENARIO,
  GUEST_GAME_SIGN_IN_PROMPT_SCENARIO,
  getActiveLocales,
  LOCALES,
  LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
  LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
  LOGIN_OPEN_SCENARIO,
  LOGIN_PHONE_SCENARIO,
  LOGIN_PICK_COUNTRY_CODE_SCENARIO,
  LOGIN_USER_AGREEMENT_SCENARIO,
  LOGIN_USER_PRIVACY_SCENARIO,
  LOGIN_USERNAME_SCENARIO,
  NICKNAME_INPUT_FIXED_TEXT,
  pageCountForViewport,
  SEARCH_SIGN_IN_PROMPT_SCENARIO,
  SIGNED_IN_PAGES,
  scenarioLabel,
  VIEWPORTS,
  VISUAL_DEVICE_ID,
} from './scenarios';

describe('visual scenarios', () => {
  const originalLocales = process.env.VISUAL_LOCALES;
  const originalScope = process.env.VISUAL_SCOPE;

  // push CI 步骤会带 VISUAL_SCOPE=core；单测默认测全量矩阵，用例内再显式设置范围
  beforeEach(() => {
    delete process.env.VISUAL_SCOPE;
  });

  afterEach(() => {
    if (originalLocales === undefined) {
      delete process.env.VISUAL_LOCALES;
    } else {
      process.env.VISUAL_LOCALES = originalLocales;
    }
    if (originalScope === undefined) {
      delete process.env.VISUAL_SCOPE;
    } else {
      process.env.VISUAL_SCOPE = originalScope;
    }
  });

  const pagesPerLocale = () =>
    VIEWPORTS.reduce((sum, viewport) => sum + pageCountForViewport(viewport.label), 0);
  test('默认 VISUAL_LOCALES 仅简体中文', () => {
    delete process.env.VISUAL_LOCALES;
    const scenarios = buildScenarios();
    assert.deepEqual(getActiveLocales(), [LOCALES[0]]);
    assert.equal(scenarios.length, pagesPerLocale());
    assert.equal(expectedScenarioCount(), pagesPerLocale());
  });

  test('VISUAL_LOCALES=all 覆盖全部语言与视口', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, LOCALES.length * pagesPerLocale());
    assert.equal(expectedScenarioCount(), LOCALES.length * pagesPerLocale());
  });

  test('VISUAL_SCOPE=core 仅保留核心页面子集', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    process.env.VISUAL_SCOPE = 'core';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, 40);
    assert.equal(expectedScenarioCount(), 40);
    assert.equal(scenarios.filter(s => s.viewport.label === 'mobile').length, 23);
    assert.equal(scenarios.filter(s => s.viewport.label === 'desktop').length, 17);
    scenarios.forEach((scenario) => {
      assert.ok(CORE_PAGE_LABELS.has(scenario.pageLabel));
    });
  });

  test('VISUAL_SCOPE=full 在简中生成全部 102 个场景', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 102);
    assert.equal(expectedScenarioCount(), 102);
  });

  test('未设置 VISUAL_SCOPE 时在简中默认生成全部 102 个场景', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    delete process.env.VISUAL_SCOPE;
    assert.equal(buildScenarios().length, 102);
    assert.equal(expectedScenarioCount(), 102);
  });

  test('VISUAL_LOCALES=all VISUAL_SCOPE=full 生成 306 个场景', () => {
    process.env.VISUAL_LOCALES = 'all';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 306);
    assert.equal(expectedScenarioCount(), 306);
  });

  test('新增业务页面有对应导航与就绪定位，签到日期固定且不提交业务', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    for (const locale of LOCALES) {
      for (const label of ['guest_message', 'guest_me', 'login_language', 'login_phone_password',
        'signed_in_slot', 'signed_in_daily_bonus', 'signed_in_hall_search',
        'signed_in_create_room_advanced_texas', 'signed_in_create_room_advanced_zhajinhua',
        'signed_in_create_room_advanced_six_plus']) {
        const scenario = scenarios.find(s => s.locale === locale.code && s.viewport.label === 'mobile'
          && s.pageLabel === label);
        assert.ok(scenario, `${locale.code}/${label} 应纳入截图清单`);
        assert.ok(scenario.visualReadySelector);
        assert.equal(scenario.signIn, label.startsWith('signed_in_'));
        assert.ok(!scenario.navClickTestIds.includes('spin-button'), '截图不能发起抽奖');
        assert.ok(!scenario.navClickTestIds.includes('daily-bonus-check-in'), '截图不能领取奖励');
      }
    }
    const bonus = SIGNED_IN_PAGES.find(page => page.label === 'signed_in_daily_bonus');
    assert.deepEqual(bonus?.fixedTexts, [{
      selector: '[data-testid="CheckInDateListItem.checkInDetailDate"]', text: '01/01',
    }]);
    assert.equal(new Set(scenarios.map(s => s.label.replace(/_/g, '-'))).size, scenarios.length,
      'Playwright 清洗后的截图文件名也必须唯一');
  });

  test('静态子页仅覆盖 mobile 视口', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const mobileOnlyPages = SIGNED_IN_PAGES.filter((pageDef) => pageDef.viewports);
    assert.ok(mobileOnlyPages.length > 0);
    mobileOnlyPages.forEach((pageDef) => {
      const matched = scenarios.filter((scenario) => scenario.pageLabel === pageDef.label);
      assert.equal(matched.length, pageDef.viewports!.length, pageDef.label);
      matched.forEach((scenario) => {
        assert.ok(pageDef.viewports!.includes(scenario.viewport.label));
      });
    });
  });

  test('场景按语言 → 视口 → 页面顺序排列', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    const expectedOrder = LOCALES.flatMap((locale) =>
      VIEWPORTS.map((viewport) => `${locale.code}_${viewport.label}`),
    );
    const actualOrder = [
      ...new Set(scenarios.map((scenario) => `${scenario.locale}_${scenario.viewport.label}`)),
    ];
    assert.deepEqual(actualOrder, expectedOrder);

    // 同一语言×视口内：大厅 → 游客牌局登录提示 → 游客私人房 → 登录首页 → 用户名登录页 → 游客俱乐部 → 登录后页面
    const zhDesktop = scenarios.filter(
      (scenario) => scenario.locale === 'zh-Hans' && scenario.viewport.label === 'desktop',
    );
    assert.equal(zhDesktop[0]?.label, 'zh-Hans_desktop_hall');
    assert.equal(zhDesktop[1]?.label, 'zh-Hans_desktop_guest_game_sign_in_prompt');
    assert.equal(zhDesktop[2]?.label, 'zh-Hans_desktop_guest_private_room');
    assert.equal(zhDesktop[3]?.label, 'zh-Hans_desktop_login');
    assert.equal(zhDesktop[4]?.label, 'zh-Hans_desktop_login_username');
    assert.equal(zhDesktop[5]?.label, 'zh-Hans_desktop_guest_club');
    assert.equal(zhDesktop[6]?.label, 'zh-Hans_desktop_search_sign_in_prompt');
    // 忘记密码相关页仅 mobile，desktop 随后进入登录后页面
    assert.equal(zhDesktop[7]?.label, 'zh-Hans_desktop_guest_message');
    assert.equal(zhDesktop[8]?.label, 'zh-Hans_desktop_guest_me');
    assert.ok(zhDesktop.some(scenario => scenario.pageLabel === 'signed_in_hall'));
  });

  test('每个场景都包含语言标识与就绪条件，label 为 locale_viewport_page', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    scenarios.forEach((scenario) => {
      assert.match(scenario.locale, /^(zh-Hans|zh-Hant|en)$/);
      assert.ok(scenario.label.startsWith(`${scenario.locale}_`));
      assert.ok(scenario.label.includes(`_${scenario.viewport.label}_`));
      assert.ok(scenario.visualReadySelector);
    });
  });

  test('大厅场景覆盖各语言 desktop/mobile', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    LOCALES.forEach((locale) => {
      VIEWPORTS.forEach((viewport) => {
        const label = scenarioLabel(locale, viewport, 'hall');
        assert.ok(scenarios.some((scenario) => scenario.label === label));
      });
    });
  });

  test('未登录俱乐部场景通过底部 tab 进入且不注入登录态', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === GUEST_CLUB_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.signIn, false);
      assert.equal(scenario.tabTestId, '');
      assert.deepEqual(scenario.navClickTestIds, GUEST_CLUB_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, GUEST_CLUB_SCENARIO.visualReadySelector);
    });
  });

  test('搜索登录提示场景点击大厅搜索并等待自定义确认弹窗', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.signIn, false);
      assert.deepEqual(scenario.navClickTestIds, SEARCH_SIGN_IN_PROMPT_SCENARIO.navClickTestIds);
      assert.equal(
        scenario.visualReadySelector,
        SEARCH_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      );
    });
  });

  test('游客点击大厅牌局后展示登录确认弹窗', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel,
    );

    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
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

  test('登录大厅不依赖可选的等级接口作为就绪条件', () => {
    const scenario = buildScenarios().find(
      (item) =>
        item.locale === 'zh-Hans' &&
        item.viewport.label === 'desktop' &&
        item.pageLabel === 'signed_in_hall',
    );
    assert.equal(scenario?.visualReadySelector, '[data-testid="hall-shortcut-buttons-container"]');
  });

  test('游客私人房场景等待空状态引导渲染完成', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === 'guest_private_room',
    );
    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.signIn, false);
      assert.equal(scenario.tabTestId, 'private-room-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="guest-private-room-empty-state"]');
    });
  });

  test('私人房 tab 场景等待详情页房屋数据渲染完成', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === 'signed_in_private_room',
    );
    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.visualReadySelector, '[data-testid="copy-house-number-button"]');
      // 就绪目标位于详情页顶部，不应为了大厅的创建入口滚动详情页列表。
      assert.equal(scenario.resetScrollSelector, undefined);
      assert.deepEqual(scenario.navClickTestIds, []);
    });
  });

  test('登录页场景通过 navClickTestIds 打开登录首页', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const loginScenarios = scenarios.filter((scenario) => scenario.label.endsWith('_login'));

    assert.equal(loginScenarios.length, 2);
    loginScenarios.forEach((scenario) => {
      assert.deepEqual(scenario.navClickTestIds, LOGIN_OPEN_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, LOGIN_OPEN_SCENARIO.visualReadySelector);
      assert.ok(scenario.readyText);
    });
  });

  test('用户名登录页场景依次点击两级入口并等待表单', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const usernameScenarios = scenarios.filter((scenario) =>
      scenario.label.endsWith('_login_username'),
    );

    assert.equal(usernameScenarios.length, 2);
    usernameScenarios.forEach((scenario) => {
      assert.deepEqual(scenario.navClickTestIds, LOGIN_USERNAME_SCENARIO.navClickTestIds);
      assert.equal(scenario.visualReadySelector, LOGIN_USERNAME_SCENARIO.visualReadySelector);
      assert.equal(scenario.signIn, false);
    });
  });

  test('忘记密码邮箱表单场景仅 mobile 并等待邮箱输入框', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const emailScenarios = scenarios.filter(
      (scenario) => scenario.pageLabel === 'login_forgot_password_email',
    );

    assert.equal(emailScenarios.length, 1);
    assert.equal(emailScenarios[0]?.viewport.label, 'mobile');
    assert.deepEqual(
      emailScenarios[0]?.navClickTestIds,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO.navClickTestIds,
    );
    assert.equal(
      emailScenarios[0]?.visualReadySelector,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO.visualReadySelector,
    );
    assert.equal(emailScenarios[0]?.signIn, false);
  });

});
