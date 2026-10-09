import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  BIO_INPUT_FIXED_TEXT,
  buildScenarios,
  LOCALES,
  LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
  LOGIN_PHONE_SCENARIO,
  LOGIN_PICK_COUNTRY_CODE_SCENARIO,
  LOGIN_USER_AGREEMENT_SCENARIO,
  LOGIN_USER_PRIVACY_SCENARIO,
  NICKNAME_INPUT_FIXED_TEXT,
  pageCountForViewport,
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

  /** 统计一个语言在全部视口下应生成的场景数。 */
  const pagesPerLocale = () =>
    VIEWPORTS.reduce((sum, viewport) => sum + pageCountForViewport(viewport.label), 0);
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
