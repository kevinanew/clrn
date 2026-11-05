import {
  LOGIN_FORGOT_PASSWORD_SCENARIO,
  LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
  LOGIN_PHONE_SCENARIO,
  LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
  LOGIN_PICK_COUNTRY_CODE_SCENARIO,
  LOGIN_USER_AGREEMENT_SCENARIO,
  LOGIN_USER_PRIVACY_SCENARIO,
} from './cases/auth/scenarios';

/** 本地定向检查的核心范围（VISUAL_SCOPE=core）；CI 始终运行完整场景。 */
export const CORE_PAGE_LABELS = new Set([
  // 本地按核心范围检查时也覆盖新增场景。
  'launch_staging_notice',
  'launch_branding',
  'guest_message',
  'guest_me',
  'login_language',
  'login_phone_password',
  'signed_in_slot',
  'signed_in_daily_bonus',
  'signed_in_hall_search',
  'signed_in_club_search_result',
  'signed_in_create_room_advanced_texas',
  'signed_in_create_room_advanced_zhajinhua',
  'signed_in_create_room_advanced_six_plus',
  'signed_in_zhajinhua_pre_game',
  'signed_in_zhajinhua_game',
  'signed_in_texas_pre_game',
  'signed_in_texas_optional_pre_game',
  'signed_in_texas_game',
  'signed_in_texas_panels',
  'signed_in_texas_hall',
  'signed_in_texas_records_v2',
  'signed_in_game_records_legacy',
  'signed_in_game_records_v2',
  'signed_in_texas_controls',
  'signed_in_texas_table_states',
  'signed_in_texas_panel_variants',
  'signed_in_texas_hall_variants',
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

/** 构造手机登录支线，保留每次场景规划独立创建的导航数组。 */
export function mobileLoginSideScenarios() {
  return [
    LOGIN_FORGOT_PASSWORD_SCENARIO,
    LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
    LOGIN_PHONE_SCENARIO,
    LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
    LOGIN_PICK_COUNTRY_CODE_SCENARIO,
    LOGIN_USER_AGREEMENT_SCENARIO,
    LOGIN_USER_PRIVACY_SCENARIO,
    {
      labelSuffix: 'login_language',
      navClickTestIds: ['hall-sign-in-button', 'switch-language-button'],
      visualReadySelector: '[data-testid="switch-language-container"]',
    },
    {
      labelSuffix: 'login_phone_password',
      navClickTestIds: [...LOGIN_PHONE_SCENARIO.navClickTestIds, 'password-sign-in-button'],
      visualReadySelector: '[data-testid="password-input"] input',
    },
  ];
}
