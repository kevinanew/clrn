export const LANGUAGE_STORAGE_KEY = 'app.language.code.key';

/**
 * 固定的 Web deviceId（localStorage['deviceId']），保证注册/登录 API 的 device_id 稳定。
 */
export const VISUAL_DEVICE_ID = 'a7f3c2e8-4d61-4b0a-9c5e-7f2d1e3a8b46';

/**
 * 固定的视觉测试账号（仅 staging）。
 * Web 端「用户名或邮箱登录」界面自带注册逻辑：用户名不存在时会先调
 * /public/v11/user/register/username_password 自动注册再登录，
 * 因此每次运行都是同一个测试用户；staging 数据清零后会自动重新注册。
 * 可用 VISUAL_USERNAME / VISUAL_PASSWORD 环境变量覆盖。
 */
export const VISUAL_TEST_USERNAME = process.env.VISUAL_USERNAME || 'laiwanvisual01';
export const VISUAL_TEST_PASSWORD = process.env.VISUAL_PASSWORD || 'visual2026test';

export type LocaleCode = 'zh-Hans' | 'zh-Hant' | 'en';

export type LocaleDef = {
  code: LocaleCode;
  label: string;
};

export type ViewportLabel = 'desktop' | 'mobile';

export type ViewportDef = {
  label: ViewportLabel;
  width: number;
  height: number;
};

/** 截图前把易变文本替换为固定值（内容仍可读，优于隐藏遮罩） */
export type FixedTextRule = {
  selector: string;
  text: string;
};

export type PageDef = {
  label: string;
  path: string;
  /** 自定义就绪选择器：截图前等待其出现并滚动到可见 */
  visualReadySelector: string;
  readyText?: Partial<Record<LocaleCode, string>>;
};

export type VisualScenario = {
  label: string;
  /** 截图场景访问路径；组件级场景可绕过常规导航。 */
  path: string;
  /** 页面标识（label 去掉 locale/viewport 前缀），冒烟过滤用 */
  pageLabel: string;
  locale: LocaleCode;
  viewport: ViewportDef;
  readyText?: string;
  visualReadySelector: string;
  /** 截图前必须完成加载的精灵图数量，避免把文本 fallback 写入基准。 */
  spriteImageCount?: number;
  /**
   * 截图前把指定滚动容器复位到顶部。用于首屏本来已包含就绪目标、但
   * scrollIntoViewIfNeeded 可能因异步布局时序留下滚动偏移的场景。
   */
  resetScrollSelector?: string;
  /**
   * 截图前等待其不可见/卸载（如选玩法 BottomSheet dismiss 动画结束）。
   * 与 visualReadySelector 配合：目标页已挂载且过渡层已消失。
   */
  visualGoneSelector?: string;
  /** true 时注入当前分片采集的登录态（失效则明确失败） */
  signIn: boolean;
  /** 独立组件级入口不挂载大厅，跳过大厅壳就绪检查。 */
  skipAppReadyCheck?: boolean;
  /** 固定 deviceId（写入 localStorage['deviceId']，所有场景统一） */
  deviceId: string;
  /** 登录后要切换的底部 tab 的 data-testid，空串表示停留在大厅 */
  tabTestId: string;
  /** 页内依次点击的 data-testid（打开登录页、进入设置子页等） */
  navClickTestIds: string[];
  waitForLoading: boolean;
  /** 截图前把易变文本替换为固定值 */
  fixedTexts: FixedTextRule[];
  /** 仅用于「出现与否本身不定」的元素（如新版本提示），display:none 摘除 */
  hideSelectors: string[];
};

export const LOCALES: LocaleDef[] = [
  { code: 'zh-Hans', label: '简中' },
  { code: 'zh-Hant', label: '繁中' },
  { code: 'en', label: 'English' },
];

export const VIEWPORTS: ViewportDef[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 375, height: 812 },
];

/** 用户余额（金币/钻石等）随签到、购买变化，截图前统一填充固定值 */
export const BALANCE_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid$="-balance-text"]',
  text: '12345',
};

/** 建房表单默认房间名取自账号昵称（CreateRoomRuleStore），随测试账号资料变化，截图前统一填充固定值 */
export const ROOM_NAME_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="room-name-input"]',
  text: 'TestRoom',
};

/** 改昵称表单输入框预填当前昵称，随测试账号资料变化，截图前统一填充固定值 */
export const NICKNAME_INPUT_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="nickname-input"]',
  text: 'TestNickname',
};

/** 改签名表单输入框预填当前签名，随测试账号资料变化，截图前统一填充固定值 */
export const BIO_INPUT_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="bio-input"]',
  text: 'TestBio',
};

export const PAGES: PageDef[] = [
  {
    label: 'hall',
    path: '/',
    // 大厅主体；登录按钮可能在折线下，截图前再 scrollIntoView
    visualReadySelector: '[data-testid="hall-sign-in-button"]',
    readyText: {
      'zh-Hans': '登录后可查看更多牌局哦',
      'zh-Hant': '登錄後可查看更多牌局哦',
      en: 'View games after sign in',
    },
  },
];

/** 未登录大厅 → 俱乐部 tab，覆盖游客登录引导及导航栏操作项。 */
export const GUEST_CLUB_SCENARIO = {
  pageLabel: 'guest_club',
  navClickTestIds: ['club-tab'],
  visualReadySelector: '[data-testid="club-tab-screen"]',
};

/** 未登录大厅点击搜索，覆盖登录确认弹窗及其遮罩、文案和操作按钮。 */
export const SEARCH_SIGN_IN_PROMPT_SCENARIO = {
  pageLabel: 'search_sign_in_prompt',
  navClickTestIds: ['hall-search-button'],
  visualReadySelector: '[data-testid="confirm-pop-up-image-background"]',
};

/** 未登录大厅 → 点击德州游客场，展示登录确认弹窗。 */
export const GUEST_GAME_SIGN_IN_PROMPT_SCENARIO = {
  pageLabel: 'guest_game_sign_in_prompt',
  navClickTestIds: ['match-game-item-texas_holdem-tourists'],
  visualReadySelector: '[data-testid="game-matching-sign-in-popup"]',
  readyText: {
    'zh-Hans': '请登录后加入游戏',
    'zh-Hant': '請登入後加入遊戲',
    en: 'Please sign in to join the game',
  } as Record<LocaleCode, string>,
};

/**
 * 登录相关页面统一走 navClickTestIds（截图前、与登录流程相同的点击原语）。
 * 注意不要改成「截图流程末尾再点击」：打开的登录 modal 会被随即卸载
 * （staging 慢时必现），排查代价极高。
 */
export const LOGIN_OPEN_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_open',
  navClickTestIds: ['hall-sign-in-button'],
  visualReadySelector: '[data-testid="sign-in-button"]',
  readyText: {
    'zh-Hans': '欢迎来到来玩',
    'zh-Hant': '歡迎來到來玩',
    en: 'Welcome to GoPlay360',
  } as Record<LocaleCode, string>,
};

/** 登录首页 → 「用户名或邮箱登录」表单页（未登录即可到达） */
export const LOGIN_USERNAME_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_username',
  navClickTestIds: ['hall-sign-in-button', 'username-or-email-sign-in-button'],
  visualReadySelector: '[data-testid="username-input"]',
};

/** 用户名登录页 → 「忘记密码」方式选择页（未登录即可到达） */
export const LOGIN_FORGOT_PASSWORD_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
  ],
  visualReadySelector: '[data-testid="reset-password-by-email-button"]',
};

/** 忘记密码方式选择 → 邮箱重置表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password_email',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
    'reset-password-by-email-button',
  ],
  visualReadySelector: '[data-testid="email-address-input"]',
};

/** 登录首页 → 手机号登录/注册表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_PHONE_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_phone',
  navClickTestIds: ['hall-sign-in-button', 'sign-in-button'],
  visualReadySelector: '[data-testid="sms-request-code-button"]',
};

/** 忘记密码方式选择 → 短信重置表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_FORGOT_PASSWORD_SMS_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password_sms',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
    'reset-password-by-sms-button',
  ],
  visualReadySelector: '[data-testid="next-button"]',
};

/** 手机号登录表单 → 选国家区号列表（未登录即可到达） */
export const LOGIN_PICK_COUNTRY_CODE_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_pick_country_code',
  navClickTestIds: ['hall-sign-in-button', 'sign-in-button', 'country-code-selector'],
  visualReadySelector: '[data-testid="pick-country-code-container"]',
};

/** 登录首页 → 用户协议（未登录即可到达） */
export const LOGIN_USER_AGREEMENT_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_user_agreement',
  navClickTestIds: ['hall-sign-in-button', 'user-agreement-button'],
  visualReadySelector: '[data-testid="user-agreement-screen"]',
};

/** 登录首页 → 隐私政策（未登录即可到达） */
export const LOGIN_USER_PRIVACY_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_user_privacy',
  navClickTestIds: ['hall-sign-in-button', 'user-privacy-button'],
  visualReadySelector: '[data-testid="user-privacy-screen"]',
};

/**
 * 登录后（固定测试账号）要覆盖的页面。
 * tabTestId 为空表示登录后停留在大厅；其余为底部 tab 的 data-testid。
 */
export type SignedInPageDef = {
  label: string;
  tabTestId: string;
  /** 切到 tab 后依次点击的 data-testid（进入设置子页等二级页面） */
  navClickTestIds?: string[];
  visualReadySelector: string;
  /** 截图前复位到顶部的滚动容器 */
  resetScrollSelector?: string;
  /** 截图前等待其不可见/卸载（过渡弹层、BottomSheet 等） */
  visualGoneSelector?: string;
  /** 截图前把易变文本替换为固定值 */
  fixedTexts?: FixedTextRule[];
  /** 仅用于「出现与否本身不定」的元素 */
  hideSelectors?: string[];
  /**
   * 覆盖的视口，缺省为全部。应用在 desktop 也是居中窄列布局，
   * 纯静态子页 desktop 与 mobile 只差左右留白，只保留 mobile 以省时间。
   */
  viewports?: ViewportLabel[];
};

/** push CI 核心范围（VISUAL_SCOPE=core）：核心页面，全量矩阵由 cron 覆盖 */
export const CORE_PAGE_LABELS = new Set([
  'hall',
  'search_sign_in_prompt',
  'guest_private_room',
  'login',
  'login_username',
  'guest_club',
  'guest_game_sign_in_prompt',
  'signed_in_hall',
  'signed_in_message',
  'signed_in_private_room',
  'signed_in_club',
  'signed_in_me',
  'signed_in_mall',
]);

export const SIGNED_IN_PAGES: SignedInPageDef[] = [
  {
    label: 'signed_in_hall',
    tabTestId: 'hall-tab',
    // 登录态已由 preparePage 校验。等级徽章还依赖独立接口，不能让它的波动阻塞大厅截图。
    visualReadySelector: '[data-testid="hall-shortcut-buttons-container"]',
  },
  {
    label: 'signed_in_message',
    tabTestId: 'message-tab',
    visualReadySelector: '[data-testid="message-screen"]',
  },
  {
    // 消息 tab → 俱乐部通知（与「我的→俱乐部通知」同屏，但入口不同）
    label: 'signed_in_message_club_notifications',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-club'],
    visualReadySelector: '[data-testid="club-notification-screen"]',
  },
  {
    label: 'signed_in_message_buy_in',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-buy-in'],
    visualReadySelector: '[data-testid="game-buy-in-application-list-screen"]',
  },
  {
    label: 'signed_in_message_system',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-system'],
    visualReadySelector: '[data-testid="system-notification-screen-root"]',
  },
  {
    label: 'signed_in_private_room',
    tabTestId: 'private-room-tab',
    // 私人房 Tab 直接渲染 PersonalHouseDetailScreen；房号复制入口仅会在房屋数据
    // 请求完成后的 HOUSE_DETAIL section 中出现，且位于页面顶部，适合作为首屏就绪条件。
    visualReadySelector: '[data-testid="copy-house-number-button"]',
  },
  {
    // club API mock 为空列表，ClubScreen 空态下默认已落在「我的俱乐部」tab
    label: 'signed_in_club',
    tabTestId: 'club-tab',
    visualReadySelector: '[data-testid="club-tab-screen"]',
  },
  {
    // 俱乐部 tab → 「牌局」空态（club API mock 为空列表）
    label: 'signed_in_club_rooms',
    tabTestId: 'club-tab',
    navClickTestIds: ['club_tab_room'],
    visualReadySelector: '[data-testid="club-rooms-empty-view"]',
  },
  {
    // 俱乐部 tab → 右上角更多弹层（仅打开，不点选项）
    label: 'signed_in_club_more',
    tabTestId: 'club-tab',
    navClickTestIds: ['show-more-button'],
    visualReadySelector: '[data-testid="club-more-popup"]',
  },
  {
    // 俱乐部 tab → 更多弹层 → 搜索俱乐部空态（不输入、不搜；club API mock 空列表）
    label: 'signed_in_club_search',
    tabTestId: 'club-tab',
    navClickTestIds: ['show-more-button', 'search-club-button'],
    visualReadySelector: '[data-testid="club-search-input"]',
    // hide() 后立即导航，须等弹层消失再截，避免叠层
    visualGoneSelector: '[data-testid="club-more-popup"]',
  },
  {
    label: 'signed_in_me',
    tabTestId: 'settings-tab',
    visualReadySelector: '[data-testid="settings-screen"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    label: 'signed_in_private_room_join',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-join'],
    // 顶部房号输入框会和详情骨架屏同时出现；等房间号复制按钮才表示下方
    // 房间资料请求完成，避免把 skeleton 写进基准图。
    visualReadySelector: '[data-testid="copy-house-number-button"]',
  },
  {
    // 私人局详情（点「创建」进入；空账号显示创建游戏按钮，不提交）
    label: 'signed_in_private_room_detail',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create'],
    // SectionList 在 skeleton 阶段也已挂载；创建按钮只在真实空房详情出现。
    visualReadySelector: '[data-testid="create-game-button"]',
    // 详情页初始化偶发自动打开选玩法弹层；详情基准不应包含该过渡态。
    visualGoneSelector: '[data-testid="select-game-category-text"]',
  },
  {
    // 详情页 → 选玩法弹层（不选具体玩法、不创建）
    label: 'signed_in_create_room_picker',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create', 'create-game-button'],
    visualReadySelector: '[data-testid="select-game-category-text"]',
  },
  {
    // 选玩法 → 经典德州建房表单首屏（不点创建）。
    // SelectRoomGameTypePopup 选中后立即 dismiss+导航，须等弹层消失再截，避免叠层。
    label: 'signed_in_create_room_form',
    tabTestId: 'private-room-tab',
    navClickTestIds: [
      'personal-house-create',
      'create-game-button',
      'game-type-button-texas_react_native',
    ],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    // 默认房间名取自账号昵称、钻石/金币余额随账号资产变化，均需固定，避免基准图随测试账号状态漂移
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
  {
    // 选玩法 → 炸金花建房表单首屏（不点创建）。同德州：须等选玩法弹层消失再截。
    label: 'signed_in_create_room_form_zhajinhua',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create', 'create-game-button', 'game-type-button-zhajinhua'],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
  {
    // 选玩法 → 短牌建房表单首屏（不点创建）。同德州：须等选玩法弹层消失再截。
    label: 'signed_in_create_room_form_six_plus',
    tabTestId: 'private-room-tab',
    navClickTestIds: [
      'personal-house-create',
      'create-game-button',
      'game-type-button-texas_six_plus',
    ],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
  {
    // 大厅首屏已包含德州/炸金花匹配区（不点开始匹配）。就绪目标会随远端牌局
    // 异步重排，scrollIntoViewIfNeeded 偶尔留下 129px 偏移；截图前须恢复首屏。
    // MatchTexasHoldem 独立页需浮动匹配态，不可达。
    label: 'signed_in_hall_match',
    tabTestId: 'hall-tab',
    visualReadySelector: '[data-testid="match-game-room-group"]',
    resetScrollSelector: '[data-testid="hall-content-list"]',
  },
  // ---- 以下均为「我的」tab 内的二级页面（点击设置项进入） ----
  {
    label: 'signed_in_profile',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button'],
    visualReadySelector: '[data-testid="profile-item-0"]',
  },
  {
    // 个人资料 → 编辑昵称表单首屏（不提交）。输入框预填当前昵称，需固定。
    label: 'signed_in_update_nickname',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button', 'profile-item-0'],
    visualReadySelector: '[data-testid="nickname-input"]',
    fixedTexts: [NICKNAME_INPUT_FIXED_TEXT],
  },
  {
    // 个人资料 → 编辑签名表单首屏（不提交）。输入框预填当前签名，需固定。
    // profile-item-3：有用户名账号为 [昵称, 用户名, 等级, 签名]
    label: 'signed_in_update_bio',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button', 'profile-item-3'],
    visualReadySelector: '[data-testid="bio-input"]',
    fixedTexts: [BIO_INPUT_FIXED_TEXT],
  },
  {
    label: 'signed_in_account_security',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security'],
    visualReadySelector: '[data-testid="account-security-items-list"]',
  },
  {
    // 账号安全 → 绑定手机（假设视觉账号为用户名注册：无手机；不提交/不进验证码）
    label: 'signed_in_bind_phone',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-0'],
    visualReadySelector: '[data-testid="input-phone-number-container"]',
  },
  {
    // 账号安全 → 绑定邮箱（假设视觉账号无邮箱；不提交/不进验证码）
    label: 'signed_in_bind_email',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-1'],
    visualReadySelector: '[data-testid="bind-email-screen"]',
  },
  {
    // 账号安全 → 修改密码（假设视觉账号已有密码；不提交）
    label: 'signed_in_reset_password',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-2'],
    visualReadySelector: '[data-testid="old-password-input"]',
  },
  {
    // 账号安全 → 注销账号首屏（不点下一步）
    label: 'signed_in_delete_account',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-3'],
    visualReadySelector: '[data-testid="warning-sign-image"]',
  },
  {
    label: 'signed_in_user_level',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-level'],
    visualReadySelector: '[data-testid="user-level-screen"]',
  },
  {
    label: 'signed_in_mall',
    tabTestId: 'settings-tab',
    navClickTestIds: ['mall'],
    // 外层容器会先于商品接口完成时挂载；必须等首个商品行出现，否则 reference
    // 会把只有余额卡、商品区全空的中间态写进基准图。
    visualReadySelector: '[data-testid^="product-amount-"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    // 商城 → 钱包流水空态（默认金币 tab）
    label: 'signed_in_currency_transaction',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['mall', 'currency-transaction-record-button'],
    visualReadySelector: '[data-testid="coin-transaction-record-view"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    label: 'signed_in_purchase_history',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['purchase-history'],
    visualReadySelector: '[data-testid="purchase-history-empty-view"]',
    // 列表头显示 APP_VERSION，发版即变
    fixedTexts: [{ selector: '[data-testid="purchase-history-version-text"]', text: '0.0.0' }],
  },
  {
    label: 'signed_in_game_record',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['game-record'],
    // 列表容器在首轮 API 请求开始时就已挂载；必须等空态出现，否则会把底部
    // loading-indicator 截进基准图。视觉账号约定无战绩，非空也应明确失败。
    visualReadySelector: '[data-testid="no-records-text"]',
  },
  {
    label: 'signed_in_gift_card',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card'],
    visualReadySelector: '[data-testid="personal-gift-card-screen-container"]',
  },
  {
    // 礼品卡 → 兑换表单首屏（不提交）
    label: 'signed_in_gift_card_exchange',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card', 'exchange-gift-card-button'],
    visualReadySelector: '[data-testid="gift-card-input"]',
  },
  {
    // 礼品卡 → 「已过期」tab 空态
    label: 'signed_in_gift_card_expired',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card', 'expired-gift-card-tab'],
    visualReadySelector: '[data-testid="expired-gift-card"]',
  },
  {
    label: 'signed_in_create_club',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['create-club'],
    visualReadySelector: '[data-testid="club-profile-list"]',
  },
  {
    label: 'signed_in_faq',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['faq'],
    visualReadySelector: '[data-testid="faq-screen"]',
  },
  {
    // FAQ 列表 → 首条详情（分享来玩，含示意图）
    label: 'signed_in_faq_detail',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['faq', 'faq-item-share_laiwan'],
    visualReadySelector: '[data-testid="faq-detail-scroll-view"]',
  },
  {
    label: 'signed_in_contact_us',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['contact-us'],
    visualReadySelector: '[data-testid="online-service-button"]',
  },
  {
    // 联系我们 → 意见反馈（第三方 UserReport 已在 pageSetup mock 成空白页）
    label: 'signed_in_feedback',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['contact-us', 'feedback-button'],
    visualReadySelector: '[data-testid="feedback-user-report-screen"]',
    hideSelectors: ['[data-testid="loading-indicator"]'],
  },
  {
    label: 'signed_in_share_app',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['share-app'],
    visualReadySelector: '[data-testid="content-image-background"]',
  },
  {
    label: 'signed_in_official_site',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['official-site'],
    visualReadySelector: '[data-testid="application-management-list"]',
  },
  {
    label: 'signed_in_download_help',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help'],
    visualReadySelector: '[data-testid="apple-button"]',
  },
  {
    label: 'signed_in_download_help_apple',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'apple-button'],
    visualReadySelector: '[data-testid="h5_link1_button"]',
  },
  {
    label: 'signed_in_download_help_android',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'android-button'],
    visualReadySelector: '[data-testid="download-android-help-view"]',
  },
  {
    label: 'signed_in_download_help_h5',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'h5-button'],
    visualReadySelector: '[data-testid="h5-version-help-view"]',
  },
  {
    label: 'signed_in_download_help_official',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'official_website-button'],
    visualReadySelector: '[data-testid="download-official-website-help-view"]',
  },
  {
    label: 'signed_in_about',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['about-laiwan'],
    // TouchableWithoutFeedback 在 Web 上会用自身 testID 覆盖子节点 Image 的 logo-image
    visualReadySelector: '[data-testid="logo-button"]',
    // 版本号随发版变化；服务器编号是测速选出的最快节点，每次运行可能不同
    fixedTexts: [
      { selector: '[data-testid="app-version-text"]', text: '0.0.0' },
      { selector: '[data-testid="latest-version-text"]', text: '0.0.0' },
      { selector: '[data-testid="current-server-text"]', text: '0' },
    ],
    // 「有新版本需要更新」提示的出现与否取决于远端版本号，本身不定
    hideSelectors: ['[data-testid="new-version-need-update-text"]'],
  },
  {
    label: 'signed_in_application_management',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['application-management'],
    visualReadySelector: '[data-testid="application-management-list"]',
  },
  {
    label: 'signed_in_club_notifications',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['club-notifications'],
    visualReadySelector: '[data-testid="club-notification-screen"]',
  },
  {
    label: 'signed_in_telegram_channel',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['telegram-channel'],
    visualReadySelector: '[data-testid="channel-url-container"]',
  },
  {
    label: 'signed_in_language',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['application-management', 'language'],
    visualReadySelector: '[data-testid="switch-language-container"]',
  },
];

function parseLocaleFilter(raw: string | undefined): LocaleCode[] | 'all' {
  const value = (raw || 'zh-Hans').trim();
  if (!value || value === 'all') {
    return 'all';
  }

  const allowed = new Set(LOCALES.map((locale) => locale.code));
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is LocaleCode => allowed.has(item as LocaleCode));

  if (selected.length === 0) {
    throw new Error(
      `VISUAL_LOCALES 无效: "${raw}"。可用值: ${LOCALES.map((l) => l.code).join(', ')}, all`,
    );
  }

  return selected;
}

export function getActiveLocales(env: NodeJS.ProcessEnv = process.env): LocaleDef[] {
  const filter = parseLocaleFilter(env.VISUAL_LOCALES);
  if (filter === 'all') {
    return LOCALES;
  }
  return LOCALES.filter((locale) => filter.includes(locale.code));
}

/**
 * 场景 label：`{locale}_{viewport}_{page}`，便于在目录与 HTML 报告中按「语言 → 视口」分组。
 * 例：`zh-Hans_desktop_hall`、`zh-Hans_mobile_signed_in_me`
 */
export function scenarioLabel(
  locale: LocaleDef,
  viewport: ViewportDef,
  pageLabel: string,
  suffix = '',
): string {
  const base = `${locale.code}_${viewport.label}_${pageLabel}`;
  return suffix ? `${base}_${suffix}` : base;
}

function buildScenario(
  page: PageDef,
  locale: LocaleDef,
  viewport: ViewportDef,
  overrides: Partial<VisualScenario> & { label?: string; pageLabel?: string } = {},
): VisualScenario {
  return {
    label: overrides.label ?? scenarioLabel(locale, viewport, page.label),
    path: overrides.path ?? page.path,
    pageLabel: overrides.pageLabel ?? page.label,
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

/** 单个「语言 × 视口」下的全部页面场景（大厅 → 登录页 → 登录后 tabs） */
function buildLocaleViewportScenarios(locale: LocaleDef, viewport: ViewportDef): VisualScenario[] {
  const hallPage = PAGES.find((item) => item.label === 'hall');
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
      pageLabel: 'guest_private_room',
      tabTestId: 'private-room-tab',
      visualReadySelector: '[data-testid="guest-private-room-empty-state"]',
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login'),
      pageLabel: 'login',
      navClickTestIds: LOGIN_OPEN_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_OPEN_SCENARIO.visualReadySelector,
      readyText: LOGIN_OPEN_SCENARIO.readyText[locale.code],
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login_username'),
      pageLabel: 'login_username',
      navClickTestIds: LOGIN_USERNAME_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_USERNAME_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, GUEST_CLUB_SCENARIO.pageLabel),
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

  // 登录支线纯静态表单/文档页，仅 mobile（desktop 只差左右留白）
  if (viewport.label === 'mobile') {
    const mobileLoginSideScenarios = [
      LOGIN_FORGOT_PASSWORD_SCENARIO,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
      LOGIN_PHONE_SCENARIO,
      LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
      LOGIN_PICK_COUNTRY_CODE_SCENARIO,
      LOGIN_USER_AGREEMENT_SCENARIO,
      LOGIN_USER_PRIVACY_SCENARIO,
    ];
    for (const sideScenario of mobileLoginSideScenarios) {
      scenarios.push(
        buildScenario(hallPage, locale, viewport, {
          label: scenarioLabel(locale, viewport, sideScenario.labelSuffix),
          pageLabel: sideScenario.labelSuffix,
          navClickTestIds: sideScenario.navClickTestIds,
          visualReadySelector: sideScenario.visualReadySelector,
          readyText: undefined,
        }),
      );
    }
  }

  for (const signedInPage of SIGNED_IN_PAGES) {
    if (signedInPage.viewports && !signedInPage.viewports.includes(viewport.label)) {
      continue;
    }
    scenarios.push(
      buildScenario(hallPage, locale, viewport, {
        label: scenarioLabel(locale, viewport, signedInPage.label),
        pageLabel: signedInPage.label,
        signIn: true,
        tabTestId: signedInPage.tabTestId,
        navClickTestIds: signedInPage.navClickTestIds ?? [],
        fixedTexts: signedInPage.fixedTexts ?? [],
        hideSelectors: signedInPage.hideSelectors ?? [],
        visualReadySelector: signedInPage.visualReadySelector,
        resetScrollSelector: signedInPage.resetScrollSelector,
        visualGoneSelector: signedInPage.visualGoneSelector,
        // 登录后页面用选择器判定就绪，不再依赖大厅未登录文案
        readyText: undefined,
      }),
    );
  }

  return scenarios;
}

export function buildScenarios(env: NodeJS.ProcessEnv = process.env): VisualScenario[] {
  const locales = getActiveLocales(env);
  const scenarios = locales.flatMap((locale) =>
    VIEWPORTS.flatMap((viewport) => buildLocaleViewportScenarios(locale, viewport)),
  );

  if (env.VISUAL_SCOPE === 'core') {
    return scenarios.filter((scenario) => CORE_PAGE_LABELS.has(scenario.pageLabel));
  }
  return scenarios;
}

/** 指定视口下的页面数（登录支线与部分静态子页仅 mobile） */
export function pageCountForViewport(viewportLabel: ViewportLabel): number {
  // 未登录页：大厅、游客牌局登录提示、私人房、登录首页、用户名登录页、俱乐部、搜索登录提示 + 登录支线 7 页（仅 mobile）+ 两个组件级牌桌
  const unauthenticated = viewportLabel === 'mobile' ? 14 : 7;
  const signedIn = SIGNED_IN_PAGES.filter(
    (page) => !page.viewports || page.viewports.includes(viewportLabel),
  ).length;
  return unauthenticated + signedIn;
}

export function expectedScenarioCount(env: NodeJS.ProcessEnv = process.env): number {
  return buildScenarios(env).length;
}
