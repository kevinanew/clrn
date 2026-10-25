/** 未登录大厅 → 俱乐部页签；截图前另由 assertGuestClubReady 核对登录横幅完整可见。 */
export const GUEST_CLUB_SCENARIO = {
  pageLabel: 'guest_club',
  navClickTestIds: ['club-tab'],
  visualReadySelector: '[data-testid="club-tab-screen"]',
};
