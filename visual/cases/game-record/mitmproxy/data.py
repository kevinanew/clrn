"""战绩视觉数据：固定日期、三种玩法、三种来源及正负零积分。"""

PLAYER = 'visual-record-player'
CLUB = 'visual-record-club'
HOUSE = 'visual-record-house'
PREFIX = 'visual-record-'
SPECS = [
    ('private', 'TexasHoldem:Classic', 'house', 'chip', 180, 10, 'Private Texas'),
    ('club', 'ZhaJinHua:Classic', 'club', 'coin', -90, 6, 'Club Cards'),
    ('hall', 'TexasHoldem:Classic', 'hall', 'coin', 0, 4, 'Hall Texas'),
    ('short', 'TexasHoldem:6Plus', 'house', 'chip', 1200, 8, 'Short Deck'),
    ('empty', 'TexasHoldem:Classic', 'house', 'chip', 0, 0, 'No Hands'),
    ('large', 'TexasHoldem:Classic', 'house', 'coin', -1234567.5, 12,
     'Long Room Name ABCDE'),
]


def records():
    """构造覆盖私人房、俱乐部、空态与不同输赢结果的战绩记录。"""
    return [{
        'play_session_id': PREFIX + key,
        'create_at': f'2026-01-0{2 if index < 3 else 1}T12:00:00Z',
        'modify_at': '2026-01-02T13:00:00Z', 'score': score, 'name': name,
        'all_round_count': count, 'game_profile': {'game_type': game, 'currency_name': currency},
        'building': {'room_id': PREFIX + key, 'room_name': name, **{
            'house': {'house_id': HOUSE},
            'club': {'club_id': CLUB, 'club_name': 'Visual Club'},
            'hall': {'hall_id': 'visual-record-hall'},
        }[building]},
    } for index, (key, game, building, currency, score, count, name) in enumerate(SPECS)]


def all_records():
    # 分页首屏使用二十条，避免短列表同时触发自动补页与滚动加载。
    """扩展固定战绩列表为足够长的分页数据，避免首屏自动补页。"""
    base = records()
    extra = []
    for index in range(17):
        room_id = PREFIX + f'page-{index + 1:02}'
        name = f'Paged Texas {index + 1:02}'
        extra.append({**base[0], 'play_session_id': room_id, 'name': name,
                      'building': {**base[0]['building'], 'room_id': room_id, 'room_name': name}})
    return base[:-1] + extra + base[-1:]


def rooms():
    """按会话 ID 索引固定房间资料。"""
    return {record['play_session_id']: room_data(record) for record in all_records()}


def room_data(record):
    """转换单条战绩，保留固定房间规则。"""
    return {
        'room_id': record['play_session_id'], 'room_name': record['name'],
        'created_at': record['create_at'], 'creator_id': HOUSE,
        'building_id': CLUB if 'club_id' in record['building'] else HOUSE,
        'building_type': building_kind(record),
        'game_type': 'zhajinhua' if record['game_profile']['game_type'].startswith('Zha') else 'texas_holdem',
        'room_status': 'closed', 'timer_status': 'time_out', 'booking_seconds': 3600,
        'remaining_seconds': 0, 'options': {
            'club_id': CLUB, 'club_name': 'Visual Club',
            'game_version': {'type': 'texas_holdem', 'variant': 'normal', 'buildNumber': 1,
                             'engineType': 'react_native'},
        },
        'game_config': {'currency': record['game_profile']['currency_name'],
                        'small_blind': 1, 'big_blind': 2, 'boot': 5, 'seat_quantity': 6,
                        'variation': variation(record)},
    }


def building_kind(record):
    """沿用俱乐部、私人房、大厅的查找顺序。"""
    return next(kind for kind in ('club', 'house', 'hall') if f'{kind}_id' in record['building'])


def variation(record):
    """会话后缀区分短牌、拼三张和普通德州。"""
    if record['play_session_id'].endswith('short'):
        return 'six_plus_holdem'
    return 'zhajinhua' if record['play_session_id'].endswith('club') else 'texas_holdem'


def settlements(user_id, room_id):
    """为非空战绩房间构造各玩家的结算明细。"""
    record = find_record(room_id)
    if not record['all_round_count']:
        return []
    return [{'user_id': player, 'settlement_amount': record['score'] * sign,
             'game_round_amount': record['all_round_count'], 'buy_in_amount': 1000}
            for player, sign in ((user_id, 1), (PLAYER, -1))]


def detail(user_id, session):
    """按战绩会话构造详情入口、轮次和玩法资料。"""
    record = find_record(session)
    return {'all_round_id': [] if session.endswith('empty') else [session + '-round'],
            'game_profile': {'#settings': {'small_blind': 1, 'big_blind': 2, 'boot': 5}},
            'scoreboard': [{'player_id': player['user_id'], 'score': player['settlement_amount'],
                            'round_count': player['game_round_amount']}
                           for player in settlements(user_id, session)],
            'stake_tracker': stake_tracker(session, record)}


def round_data(user_id, session):
    """为指定战绩会话生成对应玩法的座位与公开牌面数据。"""
    spec = game_spec(session)
    return {'game_type': spec['game'],
            'seats': {'1': user_id, '2': PLAYER},
            'all_seat_public': {'1': {'position': 'BTN', 'public_hole_card': spec['self_card']},
                                '2': {'position': 'SB', 'public_hole_card': spec['other_card']}},
            'user_secret': {'hole_card': spec['self_card']},
            'actions': [
                {'name': spec['small'], 'seat': '2', 'bet': 1, 'stack': 999},
                {'name': spec['big'], 'seat': '1', 'bet': 2, 'stack': 998},
                {'name': 'call', 'seat': '2', 'street_bet': 20, 'stack': 980},
                *spec['round_actions'],
                {'name': 'showdown', 'seat': '1', 'hole_card': spec['self_card'],
                 'best_hand_cards': 'as,ad,ah', 'hand_strength': 'three_of_a_kind'},
                {'name': 'showdown', 'seat': '2', 'hole_card': spec['other_card'],
                 'best_hand_cards': 'kh,ks,kd', 'hand_strength': 'three_of_a_kind'},
                {'name': spec['award'], 'seat': '1', 'net': 90, 'prize': 180},
                {'name': spec['award'], 'seat': '2', 'net': -90, 'prize': 0}]}


def replay(user_id, index=1, session=PREFIX + 'private'):
    """构造绑定当前用户的指定轮次牌局重放结果。"""
    net = (180, -90, 0)[index - 1]
    spec = game_spec(session)
    players = [{'player_id': user_id, 'seat_number': 1, 'position': 'D', 'stack': 1000},
               {'player_id': PLAYER, 'seat_number': 2, 'position': 'SB', 'stack': 1000}]
    return {'game_id': f'{session}-game-{index}', 'game_number': index,
            'start_at': '2026-01-01T12:00:00Z', 'game_at': '2026-01-01T12:00:00Z',
            'actions': [
                {'action_name': 'begin_play', 'game': {'variation': spec['variation']},
                 'table': {'players': players}},
                {'action_name': 'deal_hole_card', 'player_id': user_id, 'hole_card': ['as', 'ad']},
                {'action_name': 'call', 'player_id': PLAYER, 'amount': 20, 'stack': 980},
                {'action_name': spec['pot'], 'pot_amount': 180, 'pots': [180]},
                spec['replay_street'],
                {'action_name': 'showdown', 'players': [
                    dict(players[0], hole_card=spec['self_card'].split(','),
                         strength_cards=['as', 'ad', 'ah'], hand_strength='three_of_a_kind',
                         is_max_strength=True, is_winner=True),
                    dict(players[1], hole_card=spec['other_card'].split(','),
                         strength_cards=['kh', 'ks', 'kd'], hand_strength='three_of_a_kind',
                         is_max_strength=False, is_winner=False)]},
                {'action_name': 'settlement', 'players': [
                    dict(players[0], net=net), dict(players[1], net=-net)]}]}


def find_record(session):
    """查找固定会话，缺失时保留 StopIteration。"""
    return next(record for record in all_records() if record['play_session_id'] == session)


def stake_tracker(session, record):
    """空局无资金轨迹，其他局保留固定入金出金时点。"""
    if session.endswith('empty'):
        return []
    return [{'at': record['create_at'], 'fund_in': 1000, 'fund_out': 0},
            {'at': '2026-01-02T13:00:00Z', 'fund_in': 0, 'fund_out': 820}]


def game_spec(session):
    """两种玩法的固定字段与街道事件表。"""
    specs = {
        False: {'game': 'texas_holdem', 'variation': 'texas_holdem', 'self_card': 'as,ad',
                'other_card': 'kh,ks', 'small': 'small_blind', 'big': 'big_blind', 'award': 'award',
                'pot': 'pots_updated',
                'round_actions': [{'name': 'flop', 'community_card_1_to_3': 'ah,kd,7c'},
                                  {'name': 'turn', 'community_card_4': '2s'},
                                  {'name': 'river', 'community_card_5': 'qs', 'pots': [180]}],
                'replay_street': {'action_name': 'start_street', 'street': 'river',
                                  'community_card': ['ah', 'kd', '7c', '2s', 'qs']}},
        True: {'game': 'zhajinhua', 'variation': 'zha_jin_hua', 'self_card': 'as,ad,ah',
               'other_card': 'kh,ks,kd', 'small': 'ante', 'big': 'ante', 'award': 'settlement',
               'pot': 'pot_update',
               'round_actions': [{'name': 'pot_update', 'action_name': 'pot_update', 'pot_amount': 180}],
               'replay_street': {'action_name': 'start_round', 'round': 1}},
    }
    return specs[session.endswith('club')]
