import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  BIO_INPUT_FIXED_TEXT, buildScenarios, LOCALES,
  LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
  LOGIN_PHONE_SCENARIO,
  LOGIN_PICK_COUNTRY_CODE_SCENARIO,
  LOGIN_USER_AGREEMENT_SCENARIO, LOGIN_USER_PRIVACY_SCENARIO,
  NICKNAME_INPUT_FIXED_TEXT, pageCountForViewport,
  SIGNED_IN_PAGES,
  scenarioLabel,
  VIEWPORTS,
  VISUAL_DEVICE_ID,
} from './scenarios';
describe('visual scenarios', /** 核对视觉场景的生成数量、页面范围和导航配置。 */ () => {
  const originalLocales = process.env.VISUAL_LOCALES;
  const originalScope = process.env.VISUAL_SCOPE;
  // CI 使用完整场景；单测默认检查全量矩阵，需要核心范围时在用例内显式设置。
  beforeEach(/** 每个场景页配置测试前清除范围过滤，保证完整收集。 */ () => {
    delete process.env.VISUAL_SCOPE;
  });
  afterEach(/** 恢复场景页测试修改的语言和范围环境变量。 */ () => {
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
    VIEWPORTS.reduce(/** 累计各视口应生成的场景页数量。
 * @param sum - 当前操作使用的 sum。
 * @param viewport - 当前操作使用的 viewport。 */ (sum, viewport) => sum + pageCountForViewport(viewport.label), 0);
  test('登录支线场景仅 mobile 且导航链正确', /** 验证登录支线场景仅 mobile 且导航链正确。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const expected = [
      LOGIN_PHONE_SCENARIO,
      LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
      LOGIN_PICK_COUNTRY_CODE_SCENARIO,
      LOGIN_USER_AGREEMENT_SCENARIO,
      LOGIN_USER_PRIVACY_SCENARIO,
    ];
    expected.forEach(/** 核对侧栏场景唯一存在且仅生成移动端版本。
 * @param sideScenario - 当前操作使用的 sideScenario。 */ (sideScenario) => {
      const matched = scenarios.filter(
        /** 仅保留满足以下条件的条目：`scenario.pageLabel === sideScenario.labelSuffix`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === sideScenario.labelSuffix,
      );
      assert.equal(matched.length, 1, `缺少场景 ${sideScenario.labelSuffix}`);
      const [scenario] = matched;
      assert.ok(scenario);
      assert.equal(scenario.viewport.label, 'mobile');
      assert.equal(scenario.signIn, false);
      assert.deepEqual(scenario.navClickTestIds, sideScenario.navClickTestIds);
      assert.equal(scenario.visualReadySelector, sideScenario.visualReadySelector);
    });
  });
  test('易变文本场景带 fixedTexts 固定填充', /** 验证易变文本场景带 fixedTexts 固定填充。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const stabilizedPages = SIGNED_IN_PAGES.filter(/** 仅保留满足以下条件的条目：`pageDef.fixedTexts?.length`。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => pageDef.fixedTexts?.length);
    assert.ok(stabilizedPages.length > 0);
    stabilizedPages.forEach(/** 遍历需要固定文本的页面，校验各场景的稳定化配置。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => {
      scenarios
        .filter(/** 仅保留满足以下条件的条目：`scenario.label.endsWith(_${pageDef.label})`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label.endsWith(`_${pageDef.label}`))
        .forEach(/** 核对当前场景使用页面定义中的固定文本规则。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
          assert.deepEqual(scenario.fixedTexts, pageDef.fixedTexts);
        });
    });
  });
  test('设置子页场景带 navClickTestIds 并从「我的」tab 进入', /** 验证设置子页场景带 navClickTestIds 并从「我的」tab 进入。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const subPages = SIGNED_IN_PAGES.filter(/** 仅保留满足以下条件的条目：`pageDef.navClickTestIds?.length`。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => pageDef.navClickTestIds?.length);
    assert.ok(subPages.length > 0);
    subPages.forEach(/** 核对各子页面生成数量与声明的视口范围一致。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => {
      const matched = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.pageLabel === pageDef.label`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageDef.label);
      const expectedCount = pageDef.viewports?.length ?? VIEWPORTS.length;
      assert.equal(matched.length, expectedCount, `缺少场景 ${pageDef.label}`);
      matched.forEach(/** 核对登录态子页面的 tab 和页内导航步骤。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.tabTestId, pageDef.tabTestId);
        assert.deepEqual(scenario.navClickTestIds, pageDef.navClickTestIds);
      });
    });
  });
  test('建房表单场景等待选玩法弹层消失', /** 验证建房表单场景等待选玩法弹层消失。 */ () => {
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
    expectedForms.forEach(/** 查找各建房表单对应的场景并核对双视口覆盖。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ pageLabel, gameTypeButton }) => {
      const formScenarios = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.pageLabel === pageLabel`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageLabel);
      assert.equal(formScenarios.length, 2, pageLabel);
      formScenarios.forEach(/** 核对建房表单的就绪目标、弹层退出条件与导航顺序。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
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
  test('俱乐部牌局空态经顶部 tab 进入', /** 验证俱乐部牌局空态经顶部 tab 进入。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const roomScenarios = scenarios.filter(
      /** 仅保留满足以下条件的条目：`scenario.pageLabel === 'signed_in_club_rooms'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_club_rooms',
    );
    assert.equal(roomScenarios.length, 2);
    roomScenarios.forEach(/** 核对空俱乐部房间场景的登录态、入口与空态就绪条件。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'club-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="club-rooms-empty-view"]');
      assert.deepEqual(scenario.navClickTestIds, ['club_tab_room']);
    });
  });
  test('俱乐部有数据牌局经顶部 tab 进入并等待列表', /** 验证俱乐部有数据牌局经顶部 tab 进入并等待列表。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios().filter(
      /** 仅保留满足以下条件的条目：`scenario.pageLabel === 'signed_in_club_rooms_populated'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_club_rooms_populated',
    );
    assert.equal(scenarios.length, 2);
    scenarios.forEach(/** 核对非空俱乐部房间场景的登录态、列表入口及就绪条件。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'club-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="club-rooms-list"]');
      assert.deepEqual(scenario.navClickTestIds, ['club_tab_room']);
    });
  });
  test('大厅匹配场景在截图前恢复列表首屏位置', /** 验证大厅匹配场景在截图前恢复列表首屏位置。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios().filter(
      /** 仅保留满足以下条件的条目：`scenario.pageLabel === 'signed_in_hall_match'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_hall_match',
    );
    assert.equal(scenarios.length, 2);
    scenarios.forEach(/** 核对大厅场次就绪目标与滚动复位容器。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.visualReadySelector, '[data-testid="match-game-room-group"]');
      assert.equal(scenario.resetScrollSelector, '[data-testid="hall-content-list"]');
    });
  });
  test('礼品卡兑换/过期 tab 与钱包流水仅 mobile', /** 验证礼品卡兑换/过期 tab 与钱包流水仅 mobile。 */ () => {
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
      {
        pageLabel: 'signed_in_currency_transaction_diamond',
        navClickTestIds: ['mall', 'currency-transaction-record-button', 'currency_transaction_top_tab_bar_diamond'],
        visualReadySelector: '[data-testid="account-security-items-list"]',
      },
    ];
    expected.forEach(/** 核对指定设置页面的唯一移动端场景与登录配置。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ pageLabel, navClickTestIds, visualReadySelector }) => {
      const matched = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.pageLabel === pageLabel`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      const [scenario] = matched;
      assert.ok(scenario);
      assert.equal(scenario.viewport.label, 'mobile');
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'settings-tab');
      assert.deepEqual(scenario.navClickTestIds, navClickTestIds);
      assert.equal(scenario.visualReadySelector, visualReadySelector);
    });
  });
  test('商城截图等待首个商品行而不是仅等待外层容器', /** 验证商城截图等待首个商品行而不是仅等待外层容器。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const mall = scenarios.find(/** 查找满足以下条件的首个条目：`scenario.label === 'zh-Hans_desktop_signed_in_mall'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === 'zh-Hans_desktop_signed_in_mall');
    assert.ok(mall);
    assert.equal(mall.visualReadySelector, '[data-testid^="product-amount-"]');
  });
  test('加入私人房等待房间资料完成而不是仅等待顶部输入框', /** 验证加入私人房等待房间资料完成而不是仅等待顶部输入框。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hant';
    const scenarios = buildScenarios();
    const join = scenarios.find(
      /** 查找满足以下条件的首个条目：`scenario.label === 'zh-Hant_mobile_signed_in_private_room_join'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === 'zh-Hant_mobile_signed_in_private_room_join',
    );
    assert.ok(join);
    assert.equal(join.visualReadySelector, '[data-testid="copy-house-number-button"]');
  });
  test('私人房详情等待创建按钮而不是 skeleton 也包含的列表', /** 验证私人房详情等待创建按钮而不是 skeleton 也包含的列表。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hant';
    const scenarios = buildScenarios();
    const detail = scenarios.find(
      /** 查找满足以下条件的首个条目：`scenario.label === 'zh-Hant_desktop_signed_in_private_room_detail'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === 'zh-Hant_desktop_signed_in_private_room_detail',
    );
    assert.ok(detail);
    assert.equal(detail.visualReadySelector, '[data-testid="create-game-button"]');
  });
  test('游戏记录等待空态完成而不是仅等待列表容器挂载', /** 验证游戏记录等待空态完成而不是仅等待列表容器挂载。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const gameRecord = scenarios.find(
      /** 查找满足以下条件的首个条目：`scenario.label === 'zh-Hans_mobile_signed_in_game_record'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === 'zh-Hans_mobile_signed_in_game_record',
    );
    assert.ok(gameRecord);
    assert.equal(gameRecord.visualReadySelector, '[data-testid="no-records-text"]');
  });
  test('俱乐部搜索场景经更多弹层进入并等待弹层消失', /** 验证俱乐部搜索场景经更多弹层进入并等待弹层消失。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const searchScenarios = scenarios.filter(
      /** 仅保留满足以下条件的条目：`scenario.pageLabel === 'signed_in_club_search'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_club_search',
    );
    assert.equal(searchScenarios.length, 2);
    searchScenarios.forEach(/** 核对俱乐部搜索场景的入口、搜索框及弹层消失条件。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.tabTestId, 'club-tab');
      assert.equal(scenario.visualReadySelector, '[data-testid="club-search-input"]');
      assert.equal(scenario.visualGoneSelector, '[data-testid="club-more-popup"]');
      assert.deepEqual(scenario.navClickTestIds, ['show-more-button', 'search-club-button']);
    });
    const resultScenarios = scenarios.filter(
      /** 仅保留满足以下条件的条目：`scenario.pageLabel === 'signed_in_club_search_result'`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === 'signed_in_club_search_result',
    );
    assert.equal(resultScenarios.length, 2);
    resultScenarios.forEach(/** 核对俱乐部搜索结果场景的导航与展示就绪条件。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.signIn, true);
      assert.equal(scenario.visualReadySelector, '[data-testid="club-search-input"]');
      assert.equal(scenario.visualGoneSelector, '[data-testid="club-more-popup"]');
      assert.deepEqual(scenario.navClickTestIds, ['show-more-button', 'search-club-button']);
    });
  });
  test('账号安全二级页仅 mobile，经列表项进入且不提交', /** 验证账号安全二级页仅 mobile，经列表项进入且不提交。 */ () => {
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
    expected.forEach(/** 查找每个账号安全页面场景并校验移动端覆盖。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ pageLabel, itemTestId, visualReadySelector }) => {
      const matched = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.pageLabel === pageLabel`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      matched.forEach(/** 核对账号安全子页面的登录态与导航到目标设置项的步骤。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.viewport.label, 'mobile');
        assert.equal(scenario.tabTestId, 'settings-tab');
        assert.deepEqual(scenario.navClickTestIds, ['account-security', itemTestId]);
        assert.equal(scenario.visualReadySelector, visualReadySelector);
      });
    });
  });
  test('编辑昵称/签名表单仅 mobile，经个人资料进入且固定输入框文案', /** 验证编辑昵称/签名表单仅 mobile，经个人资料进入且固定输入框文案。 */ () => {
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
    expected.forEach(/** 查找每个个人资料编辑页面场景并核验唯一性。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ pageLabel, itemTestId, visualReadySelector, fixedTexts }) => {
      const matched = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.pageLabel === pageLabel`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.pageLabel === pageLabel);
      assert.equal(matched.length, 1, `缺少场景 ${pageLabel}`);
      matched.forEach(/** 核对个人资料子页面的移动端配置与用户信息导航步骤。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
        assert.equal(scenario.signIn, true);
        assert.equal(scenario.viewport.label, 'mobile');
        assert.equal(scenario.tabTestId, 'settings-tab');
        assert.deepEqual(scenario.navClickTestIds, ['user-info-button', itemTestId]);
        assert.equal(scenario.visualReadySelector, visualReadySelector);
        assert.deepEqual(scenario.fixedTexts, fixedTexts);
      });
    });
  });
  test('VISUAL_LOCALES=zh-Hant,en 仅生成非简中场景', /** 验证VISUAL_LOCALES=zh-Hant,en 仅生成非简中场景。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hant,en';
    const scenarios = buildScenarios();
    assert.equal(scenarios.length, 2 * pagesPerLocale());
    scenarios.forEach(/** 确认当前受限场景不会生成简体中文版本。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.notEqual(scenario.locale, 'zh-Hans');
    });
  });
  test('登录场景固定设备并覆盖全部登录后页面', /** 验证登录场景固定设备并覆盖全部登录后页面。 */ () => {
    process.env.VISUAL_LOCALES = 'zh-Hans';
    const scenarios = buildScenarios();
    const signedInScenarios = scenarios.filter(/** 仅保留满足以下条件的条目：`scenario.signIn`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.signIn);
    const zhLocale = LOCALES[0];
    const expectedSignedIn = SIGNED_IN_PAGES.reduce(
      /** 累计登录态页面按声明视口展开后的预期场景数量。
 * @param sum - 当前操作使用的 sum。
 * @param pageDef - 当前操作使用的 pageDef。 */ (sum, pageDef) => sum + (pageDef.viewports?.length ?? VIEWPORTS.length),
      0,
    );
    assert.equal(signedInScenarios.length, expectedSignedIn);
    signedInScenarios.forEach(/** 核对登录态场景的设备标识、就绪选择器与文本等待策略。
 * @param scenario - 当前测试场景配置。 */ (scenario) => {
      assert.equal(scenario.deviceId, VISUAL_DEVICE_ID);
      assert.ok(scenario.visualReadySelector);
      assert.equal(scenario.readyText, undefined);
    });
    SIGNED_IN_PAGES.forEach(/** 遍历各登录态页面支持的视口，核对完整场景矩阵。
 * @param pageDef - 当前操作使用的 pageDef。 */ (pageDef) => {
      VIEWPORTS.filter(/** 仅保留满足以下条件的条目：`!pageDef.viewports || pageDef.viewports.includes(viewport.label)`。
 * @param viewport - 当前操作使用的 viewport。 */ (viewport) => !pageDef.viewports || pageDef.viewports.includes(viewport.label),
      ).forEach(/** 构造当前页面与视口的预期标签并确认场景已生成。
 * @param viewport - 当前操作使用的 viewport。 */ (viewport) => {
        const label = scenarioLabel(zhLocale, viewport, pageDef.label);
        assert.ok(signedInScenarios.some(/** 判断是否存在满足以下条件的条目：`scenario.label === label`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.label === label),
          `缺少场景 ${label}`,
        );
      });
    });
  });
});
