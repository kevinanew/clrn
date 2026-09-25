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
    assert.equal(scenarios.length, 30);
    assert.equal(expectedScenarioCount(), 30);
    assert.equal(scenarios.length, CORE_PAGE_LABELS.size * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.ok(CORE_PAGE_LABELS.has(scenario.pageLabel));
    });
  });

  test('VISUAL_SCOPE=full 在简中生成全部 92 个场景', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 92);
    assert.equal(expectedScenarioCount(), 92);
  });

  test('未设置 VISUAL_SCOPE 时在简中默认生成全部 92 个场景', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    delete process.env.VISUAL_SCOPE;
    assert.equal(buildScenarios().length, 92);
    assert.equal(expectedScenarioCount(), 92);
  });

  test('VISUAL_LOCALES=all VISUAL_SCOPE=full 生成 276 个场景', () => {
    process.env.VISUAL_LOCALES = 'all';
    process.env.VISUAL_SCOPE = 'full';
    assert.equal(buildScenarios().length, 276);
    assert.equal(expectedScenarioCount(), 276);
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
    assert.equal(zhDesktop[7]?.label, 'zh-Hans_desktop_signed_in_hall');
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

  test('经典德州等待开局为固定组件级入口，覆盖各语言 desktop/mobile', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === 'texas_holdem_waiting',
    );
    assert.equal(scenarios.length, LOCALES.length * VIEWPORTS.length);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.path, '/?visualScenario=texas-holdem-waiting');
      assert.equal(scenario.signIn, false);
      assert.equal(scenario.skipAppReadyCheck, true);
      assert.equal(scenario.waitForLoading, false);
      assert.equal(scenario.visualReadySelector, '[data-testid="texas_holdem_main_pot_container"]');
      assert.deepEqual(scenario.fixedTexts, [
        { selector: '[data-testid="texas_holdem_main_pot_amount"]', text: '0' },
      ]);
    });
  });

  test('经典德州翻牌圈等待本人手牌渲染完成，覆盖各语言 desktop/mobile', () => {
    process.env.VISUAL_LOCALES = 'all';
    const scenarios = buildScenarios();
    const flop = scenarios.filter((scenario) => scenario.pageLabel === 'texas_holdem_flop');
    assert.equal(flop.length, LOCALES.length * VIEWPORTS.length);
    flop.forEach((scenario) => {
      assert.equal(scenario.path, '/?visualScenario=texas-holdem-flop');
      assert.equal(scenario.visualReadySelector, '[data-testid="texas-holdem-player-hole-cards"]');
      assert.equal(scenario.spriteImageCount, 5);
      assert.equal(scenario.skipAppReadyCheck, true);
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

  test('登录支线场景仅 mobile 且导航链正确', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expected = [
      LOGIN_PHONE_SCENARIO,
      LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
      LOGIN_PICK_COUNTRY_CODE_SCENARIO,
      LOGIN_USER_AGREEMENT_SCENARIO,
      LOGIN_USER_PRIVACY_SCENARIO,
    ];

    expected.forEach((sideScenario) => {
      const matched = scenarios.filter(
        (scenario) => scenario.pageLabel === sideScenario.labelSuffix,
      );
      assert.equal(matched.length, 1, `缺少场景 ${sideScenario.labelSuffix}`);
      assert.equal(matched[0]?.viewport.label, 'mobile');
      assert.equal(matched[0]?.signIn, false);
      assert.deepEqual(matched[0]?.navClickTestIds, sideScenario.navClickTestIds);
      assert.equal(matched[0]?.visualReadySelector, sideScenario.visualReadySelector);
    });
  });

  test('易变文本场景带 fixedTexts 固定填充', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const stabilizedPages = SIGNED_IN_PAGES.filter((pageDef) => pageDef.fixedTexts?.length);

    assert.ok(stabilizedPages.length > 0);
    stabilizedPages.forEach((pageDef) => {
      scenarios
        .filter((scenario) => scenario.label.endsWith(`_${pageDef.label}`))
        .forEach((scenario) => {
          assert.deepEqual(scenario.fixedTexts, pageDef.fixedTexts);
        });
    });
  });

  test('设置子页场景带 navClickTestIds 并从「我的」tab 进入', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const subPages = SIGNED_IN_PAGES.filter((pageDef) => pageDef.navClickTestIds?.length);

    assert.ok(subPages.length > 0);
    subPages.forEach((pageDef) => {
      const matched = scenarios.filter((scenario) => scenario.pageLabel === pageDef.label);
      const expectedCount = pageDef.viewports?.length ?? VIEWPORTS.length;
      assert.equal(matched.length, expectedCount, `缺少场景 ${pageDef.label}`);
      matched.forEach((scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.tabTestId, pageDef.tabTestId);
        assert.deepEqual(scenario.navClickTestIds, pageDef.navClickTestIds);
      });
    });
  });

  test('建房表单场景等待选玩法弹层消失', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expectedForms = [
      {
        pageLabel: 'signed_in_create_room_form',
        gameTypeButton: 'game-type-button-texas_react_native',
      },
      {
        pageLabel: 'signed_in_create_room_form_zhajinhua',
        gameTypeButton: 'game-type-button-zhajinhua',
      },
      {
        pageLabel: 'signed_in_create_room_form_six_plus',
        gameTypeButton: 'game-type-button-texas_six_plus',
      },
    ];

    expectedForms.forEach(({ pageLabel, gameTypeButton }) => {
      const formScenarios = scenarios.filter((scenario) => scenario.pageLabel === pageLabel);
      assert.equal(formScenarios.length, 2, pageLabel);
      formScenarios.forEach((scenario) => {
        assert.equal(scenario.visualReadySelector, '[data-testid="base-create-room-screen"]');
        assert.equal(scenario.visualGoneSelector, '[data-testid="select-game-category-text"]');
        assert.deepEqual(scenario.navClickTestIds, [
          'personal-house-create',
          'create-game-button',
          gameTypeButton,
        ]);
      });
    });
  });

  test('俱乐部牌局空态经顶部 tab 进入', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const roomScenarios = scenarios.filter(
      (scenario) => scenario.pageLabel === 'signed_in_club_rooms',
    );

    assert.equal(roomScenarios.length, 2);
    roomScenarios.forEach((scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'club-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="club-rooms-empty-view"]');
      assert.deepEqual(scenario.navClickTestIds, ['club_tab_room']);
    });
  });

  test('大厅匹配场景在截图前恢复列表首屏位置', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios().filter(
      (scenario) => scenario.pageLabel === 'signed_in_hall_match',
    );

    assert.equal(scenarios.length, 2);
    scenarios.forEach((scenario) => {
      assert.equal(scenario.visualReadySelector, '[data-testid="match-game-room-group"]');
      assert.equal(scenario.resetScrollSelector, '[data-testid="hall-content-list"]');
    });
  });

  test('礼品卡兑换/过期 tab 与钱包流水仅 mobile', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expected = [
      {
        pageLabel: 'signed_in_gift_card_exchange',
        navClickTestIds: ['gift-card', 'exchange-gift-card-button'],
        visualReadySelector: '[data-testid="gift-card-input"]',
      },
      {
        pageLabel: 'signed_in_gift_card_expired',
        navClickTestIds: ['gift-card', 'expired-gift-card-tab'],
        visualReadySelector: '[data-testid="expired-gift-card"]',
      },
      {
        pageLabel: 'signed_in_currency_transaction',
        navClickTestIds: ['mall', 'currency-transaction-record-button'],
        visualReadySelector: '[data-testid="coin-transaction-record-view"]',
      },
    ];

    expected.forEach(({ pageLabel, navClickTestIds, visualReadySelector }) => {
      const matched = scenarios.filter((scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      assert.equal(matched[0]?.viewport.label, 'mobile');
      assert.equal(matched[0]?.signIn, true);
      assert.equal(matched[0]?.tabTestId, 'settings-tab');
      assert.deepEqual(matched[0]?.navClickTestIds, navClickTestIds);
      assert.equal(matched[0]?.visualReadySelector, visualReadySelector);
    });
  });

  test('商城截图等待首个商品行而不是仅等待外层容器', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const mall = scenarios.find((scenario) => scenario.label === 'zh-Hans_desktop_signed_in_mall');

    assert.ok(mall);
    assert.equal(mall.visualReadySelector, '[data-testid^="product-amount-"]');
  });

  test('加入私人房等待房间资料完成而不是仅等待顶部输入框', () => {
    process.env.VISUAL_LOCALES = 'zh-Hant';
    const scenarios = buildScenarios();
    const join = scenarios.find(
      (scenario) => scenario.label === 'zh-Hant_mobile_signed_in_private_room_join',
    );

    assert.ok(join);
    assert.equal(join.visualReadySelector, '[data-testid="copy-house-number-button"]');
  });

  test('私人房详情等待创建按钮而不是 skeleton 也包含的列表', () => {
    process.env.VISUAL_LOCALES = 'zh-Hant';
    const scenarios = buildScenarios();
    const detail = scenarios.find(
      (scenario) => scenario.label === 'zh-Hant_desktop_signed_in_private_room_detail',
    );

    assert.ok(detail);
    assert.equal(detail.visualReadySelector, '[data-testid="create-game-button"]');
  });

  test('游戏记录等待空态完成而不是仅等待列表容器挂载', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const gameRecord = scenarios.find(
      (scenario) => scenario.label === 'zh-Hans_mobile_signed_in_game_record',
    );

    assert.ok(gameRecord);
    assert.equal(gameRecord.visualReadySelector, '[data-testid="no-records-text"]');
  });

  test('俱乐部搜索场景经更多弹层进入并等待弹层消失', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const searchScenarios = scenarios.filter(
      (scenario) => scenario.pageLabel === 'signed_in_club_search',
    );

    assert.equal(searchScenarios.length, 2);
    searchScenarios.forEach((scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'club-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="club-search-input"]');
      assert.equal(scenario.visualGoneSelector, '[data-testid="club-more-popup"]');
      assert.deepEqual(scenario.navClickTestIds, ['show-more-button', 'search-club-button']);
    });
  });

  test('账号安全二级页仅 mobile，经列表项进入且不提交', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expected = [
      {
        pageLabel: 'signed_in_bind_phone',
        itemTestId: 'account-security-item-0',
        visualReadySelector: '[data-testid="input-phone-number-container"]',
      },
      {
        pageLabel: 'signed_in_bind_email',
        itemTestId: 'account-security-item-1',
        visualReadySelector: '[data-testid="bind-email-screen"]',
      },
      {
        pageLabel: 'signed_in_reset_password',
        itemTestId: 'account-security-item-2',
        visualReadySelector: '[data-testid="old-password-input"]',
      },
      {
        pageLabel: 'signed_in_delete_account',
        itemTestId: 'account-security-item-3',
        visualReadySelector: '[data-testid="warning-sign-image"]',
      },
    ];

    expected.forEach(({ pageLabel, itemTestId, visualReadySelector }) => {
      const matched = scenarios.filter((scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      matched.forEach((scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.viewport.label, 'mobile');
        assert.equal(scenario.tabTestId, 'settings-tab');
        assert.deepEqual(scenario.navClickTestIds, ['account-security', itemTestId]);
        assert.equal(scenario.visualReadySelector, visualReadySelector);
      });
    });
  });

  test('编辑昵称/签名表单仅 mobile，经个人资料进入且固定输入框文案', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expected = [
      {
        pageLabel: 'signed_in_update_nickname',
        itemTestId: 'profile-item-0',
        visualReadySelector: '[data-testid="nickname-input"]',
        fixedTexts: [NICKNAME_INPUT_FIXED_TEXT],
      },
      {
        pageLabel: 'signed_in_update_bio',
        itemTestId: 'profile-item-3',
        visualReadySelector: '[data-testid="bio-input"]',
        fixedTexts: [BIO_INPUT_FIXED_TEXT],
      },
    ];

    expected.forEach(({ pageLabel, itemTestId, visualReadySelector, fixedTexts }) => {
      const matched = scenarios.filter((scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      matched.forEach((scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.viewport.label, 'mobile');
        assert.equal(scenario.tabTestId, 'settings-tab');
        assert.deepEqual(scenario.navClickTestIds, ['user-info-button', itemTestId]);
        assert.equal(scenario.visualReadySelector, visualReadySelector);
        assert.deepEqual(scenario.fixedTexts, fixedTexts);
      });
    });
  });

  test('VISUAL_LOCALES=zh-Hant,en 仅生成非简中场景', () => {
    process.env.VISUAL_LOCALES = 'zh-Hant,en';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, 2 * pagesPerLocale());
    scenarios.forEach((scenario) => {
      assert.notEqual(scenario.locale, 'zh-Hans');
    });
  });

  test('登录场景固定设备并覆盖全部登录后页面', () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const signedInScenarios = scenarios.filter((scenario) => scenario.signIn);
    const zhLocale = LOCALES[0];

    const expectedSignedIn = SIGNED_IN_PAGES.reduce(
      (sum, pageDef) => sum + (pageDef.viewports?.length ?? VIEWPORTS.length),
      0,
    );
    assert.equal(signedInScenarios.length, expectedSignedIn);
    signedInScenarios.forEach((scenario) => {
      assert.equal(scenario.deviceId, VISUAL_DEVICE_ID);
      assert.ok(scenario.visualReadySelector);
      assert.equal(scenario.readyText, undefined);
    });

    SIGNED_IN_PAGES.forEach((pageDef) => {
      VIEWPORTS.filter(
        (viewport) => !pageDef.viewports || pageDef.viewports.includes(viewport.label),
      ).forEach((viewport) => {
        const label = scenarioLabel(zhLocale, viewport, pageDef.label);
        assert.ok(
          signedInScenarios.some((scenario) => scenario.label === label),
          `缺少场景 ${label}`,
        );
      });
    });
  });
});
