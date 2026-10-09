/** 面向浏览者的页面名称；原始场景标识仍保留在数据、搜索与截图详情中。 */
export const PAGE_NAME_PARTS: Record<string, string> = {
  game_records_legacy: '我的战绩（旧版）', game_records_v2: '我的战绩（新版）',
  records_v2: '牌谱（新版）', panel_variants: '弹窗状态', hall_variants: '大厅状态',
  table_states: '牌桌状态', private_room: '私人房', create_room: '创建房间',
  forgot_password: '找回密码', phone_password: '手机号密码登录', pick_country_code: '选择国家区号',
  user_agreement: '用户协议', user_privacy: '隐私政策', game_sign_in_prompt: '游戏登录提示',
  search_sign_in_prompt: '搜索登录提示', daily_bonus: '每日奖励', pre_game: '开局前',
  waiting_table: '等待开局', card_rank: '牌型说明', buy_in_applications: '带入申请',
  buy_in_review: '带入审核', accurate_raise_minimum_error: '精确加注金额过低',
  accurate_raise_value: '精确加注金额', accurate_raise: '精确加注', quick_raise: '快捷加注',
  own_profile: '我的资料', player_profile: '玩家资料', player_statistics: '玩家数据',
  statistics_help: '数据说明', opponent_turn: '对手回合', all_in_only: '仅可全下',
  all_in_call: '全下跟注', all_in: '全下', blind_cards: '未看牌', seen_cards: '已看牌',
  challenge_select: '选择比牌对手', game_record: '牌谱', four_color_two: '四色牌面（二）',
  four_color: '四色牌面', settings_enabled: '设置已开启', leaderboard_players: '玩家排行',
  record_settlement: '牌谱结算', record_actions: '牌谱行动记录', chat_phrases: '快捷聊天',
  chat_history: '聊天记录', chat_actions: '聊天操作', chat_report: '举报聊天',
  chat_block_confirm: '屏蔽聊天确认', hand_end: '本局结束', remaining_cards: '剩余牌',
  show_cards: '亮牌', quit_confirm: '退出确认', hall_table: '大厅牌桌', hall_menu: '大厅菜单',
  auto_rebuy_enabled: '自动补充已开启', auto_rebuy: '自动补充', pair_play_report: '协同对局举报',
  personal_leaderboard: '个人排行', prediction_result: '预测结果', level_up: '升级提示',
  shortcut_blinds: '盲注快捷加注', shortcut_disabled: '快捷加注不可用', auto_buttons: '自动操作',
  auto_fold_selected: '已选择自动弃牌', auto_call_selected: '已选择自动跟注',
  auto_check_selected: '已选择自动过牌', raise_maximum: '最大加注', raise_dragging: '拖动加注金额',
  full_table: '满员牌桌', reserved_seat: '预留座位', player_disconnected: '玩家断线',
  guest_menu: '游客菜单', applications_pending: '待处理申请', applications_resolved: '已处理申请',
  applications_more: '更多申请', chat_audio_history: '语音聊天记录', chat_barrage_off: '聊天弹幕已关闭',
  alert_retry: '重试提示', alert_insufficient_balance: '余额不足提示',
  alert_authentication_failed: '身份验证失败提示', pair_play_selected: '已选择协同对局',
  prediction_bet: '预测下注', prediction_loss: '预测失败', prediction_diamond: '预测钻石奖励',
  delay_cooldown_alert: '延时冷却提示', delay_cooldown: '延时冷却',
  list_bottom: '列表底部', select_none: '尚未选择', select_win: '选择赢局', select_loss: '选择输局',
  select_all: '全选', select_clear: '清空选择', select_cancel: '取消选择', swipe_delete: '滑动删除',
  delete_confirm: '确认删除', delete_cancel: '取消删除', delete_blocked: '无法删除',
  private_relationship_switch: '切换私人房关系', private_relationship: '私人房关系',
  private_overview: '私人房概览', private_actions: '私人房行动记录', private_settlement: '私人房结算',
  replay_list: '回放列表', club_overview: '俱乐部概览', club_actions: '俱乐部行动记录',
  club_settlement: '俱乐部结算', hall_overview: '大厅概览', short_deck_overview: '短牌概览',
  no_hands: '没有手牌', replay_empty: '没有回放', delete_success: '删除成功', delete_failure: '删除失败',
  pagination_loading: '加载下一页', pagination_end: '已到最后一页', list_failure: '列表加载失败',
  retry_success: '重试成功', detail_failure: '详情加载失败',
  update_nickname: '修改昵称', update_bio: '修改签名', account_security: '账号安全',
  bind_phone: '绑定手机号', bind_email: '绑定邮箱', reset_password: '修改密码',
  delete_account: '注销账号', user_level: '用户等级', application_management: '应用管理',
  club_notifications: '俱乐部通知', telegram_channel: 'Telegram 频道', create_club: '创建俱乐部',
  currency_transaction: '货币流水', purchase_history: '购买记录', gift_card_exchange: '兑换礼品卡',
  gift_card_expired: '已过期礼品卡', gift_card: '礼品卡', faq_detail: '问题详情',
  contact_us: '联系我们', share_app: '分享应用', official_site: '官方网站',
  download_help: '下载帮助',
  hall: '大厅', auth: '登录', login: '登录', username: '用户名登录', phone: '手机号登录',
  email: '邮箱', sms: '短信', language: '语言设置', club: '俱乐部', rooms: '房间列表',
  more: '更多操作', search: '搜索', message: '消息', buy_in: '带入', system: '系统通知',
  me: '我的', profile: '个人资料', texas: '德州', zhajinhua: '拼三张', six_plus: '短牌',
  optional: '可选配置', raise_blinds: '升盲详情', game: '对局', panels: '面板',
  menu: '菜单', theme: '主题', settings: '设置', renew: '续费', leaderboard: '排行榜',
  chat: '聊天', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌',
  raise: '加注', showdown: '摊牌', settlement: '结算', report: '举报', block: '屏蔽',
  realistic: '真实牌面', table: '牌桌', blue: '蓝色', purple: '紫色', black: '黑色',
  voice: '语音', prediction: '预测', controls: '操作按钮', check: '过牌', observer: '旁观',
  loading: '加载中', empty: '空列表', list: '列表', actions: '行动记录', reopen: '重新打开',
  mall: '商城', faq: '常见问题', feedback: '意见反馈', apple: '苹果手机', android: '安卓手机',
  h5: '网页版', official: '官方渠道', about: '关于', join: '加入房间', detail: '详情',
  picker: '选择玩法', form: '表单', advanced: '高级设置', match: '匹配', slot: '抽奖',
};

export function displayPageName(label: string): string {
  const guest = label.startsWith('guest_');
  const words = label.replace(/^(signed_in_|guest_)/, '').split('_');
  const parts: string[] = [];
  while (words.length) {
    let length = words.length;
    while (length > 1 && !PAGE_NAME_PARTS[words.slice(0, length).join('_')]) length--;
    const phrase = words.splice(0, length).join('_');
    parts.push(PAGE_NAME_PARTS[phrase] || phrase);
  }
  return (guest ? '游客 · ' : '') + parts.join(' · ');
}
