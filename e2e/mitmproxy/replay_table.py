"""具名牌桌回放的布局、座位和操作数据。"""

import copy

PLAYERS = [f'00000000-0000-4000-8000-{index:012d}' for index in range(1, 9)]
CARDS = ['ah', 'kd', '7c', '2s', 'qs']
STREETS = {'preflop': 0, 'flop': 3, 'turn': 4, 'river': 5}
LAYOUTS = {'standard', 'observer', 'full', 'full-pots', 'check', 'all-in-only',
           'all-in-call', 'shortcut-blinds', 'shortcut-disabled'}
BETS = {
    'check': {'fold': {}, 'check': {}, 'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}},
    'all-in-only': {'fold': {}, 'all_in': {'amount': 15}},
    'all-in-call': {'fold': {}, 'call': {'amount': 15}, 'all_in': {'amount': 15}},
    'shortcut-disabled': {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 50}, 'all_in': {'amount': 50}},
}
BETS['shortcut-blinds'] = BETS['check']
INITIAL_BETS = {
    'texas': {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}},
    'zhajinhua': {'fold': {}, 'call': {'amount': 10}, 'challenge': {'amount': 20},
                 'raise': {'minimum': 20, 'maximum': 100, 'step': 10}, 'all_in': {'amount': 1000}},
}
STATUS_EVENTS = ('room_status', 'game_status', 'table_status')


def initial_queue(game, status, operating):
    """保留两种玩法的原始事件顺序和独立状态快照。"""
    room = {'event': 'room_status', 'status': {**copy.deepcopy(status), 'state': 'running'}}
    table = {'event': 'table_status', 'status': copy.deepcopy(status)}
    operation = {'event': 'operating_player_status', 'status': operating}
    game_id = 'visual-fixed-game' if game == 'texas' else 'visual-fixed-zhajinhua-game'
    snapshot = {'event': 'game_status', 'game_id': game_id, 'status': copy.deepcopy(status)}
    if game == 'texas':
        return [room, snapshot, table,
                {'event': 'hand_card', 'player_id': '@self', 'hole_card': ['as', 'ad'], 'hand_strength': 'one_pair'},
                operation, {'event': 'hand_analyse', 'hand_power': 82}]
    return [room, snapshot, operation, table]


def validate_parameters(parameters, allowed, choices):
    """按固定参数表验证键和枚举值。"""
    if not set(parameters) <= allowed:
        raise ValueError('Unknown table parameters')
    for key, (default, options) in choices.items():
        validate_choice(parameters.get(key, default), options)


def validate_choice(value, options):
    """拒绝未登记的场景值。"""
    if value not in options:
        raise ValueError('Unknown table scene')


def texas_parameters(parameters):
    """验证德州街道、当前操作人和布局。"""
    validate_parameters(parameters, {'street', 'turn', 'layout'}, {
        'street': ('river', STREETS), 'turn': ('self', ('self', 'opponent')),
        'layout': ('standard', LAYOUTS)})
    return parameters.get('street', 'river'), parameters.get('turn', 'self'), parameters.get('layout', 'standard')


def layout_players(layout):
    """按满桌、标准及旁观布局选择玩家。"""
    players = PLAYERS if layout == 'observer' else ['@self', *PLAYERS]
    return players if layout in ('full', 'full-pots') else players[:layout_capacity(layout)]


def layout_capacity(layout):
    """旁观布局保留四名玩家，普通布局保留五名。"""
    return 4 if layout == 'observer' else 5


def seat_player(index, players, positions):
    """生成占用座位的固定玩家数据，空座保留 None。"""
    if index >= len(players):
        return None
    return {'player_id': players[index], 'seat_number': index + 1,
            'stack': 1000 - index * 40, 'buy_in': 1000, 'is_leave': False, 'is_playing': True,
            'position': positions[index], 'last_action': {'name': 'fold' if index == 3 else 'call', 'amount': 20},
            'public_hole_card': [], 'hole_card': []}


def update_seat(seat, index, players, positions):
    """更新座位状态、方位和玩家信息。"""
    seat.update(state='occupied' if index < len(players) else 'empty',
                position=positions[index] if index < len(positions) else '')
    seat['player'] = seat_player(index, players, positions)


def update_seats(status, layout):
    """仅满桌和旁观布局重建座位，普通布局保留真实模板。"""
    if layout not in ('full', 'full-pots', 'observer'):
        return
    positions = layout_positions(layout)
    for index, seat in enumerate(status['seats']):
        update_seat(seat, index, layout_players(layout), positions)


def layout_positions(layout):
    """保持按钮位及旁观布局的原始座位方位。"""
    if layout == 'observer':
        return ['D', 'SB', 'BB', 'UTG', 'CO']
    return ['BTN', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO']


def update_texas_status(status, street, layout):
    """修改街道和公共牌，再应用布局专有底池。"""
    status['street'] = street
    status['community_card'] = CARDS[:STREETS[street]]
    pots = [6] if street == 'preflop' else [120, 60]
    status['pots'] = {'full-pots': [90, 80, 70, 60, 50, 40, 30, 20, 10],
                      'shortcut-blinds': [3]}.get(layout, pots)
    update_seats(status, layout)


def table_statuses(queue):
    """选择独立的房间、游戏和牌桌快照。"""
    return [event['status'] for event in queue if event['event'] in STATUS_EVENTS]


def operating_owner(turn, layout):
    """对手操作或旁观模式使用首位虚拟玩家。"""
    return PLAYERS[0] if any((turn == 'opponent', layout == 'observer')) else '@self'


def texas_table(value, operating, parameters):
    """组合已验证的德州布局和操作状态。"""
    street, turn, layout = texas_parameters(parameters)
    for status in table_statuses(value['queue']):
        update_texas_status(status, street, layout)
    operating['player_id'] = operating_owner(turn, layout)
    operating['valid_bets'] = copy.deepcopy(BETS.get(layout, operating['valid_bets']))
    remove_private_hand(value, layout)


def remove_private_hand(value, layout):
    """旁观者不收到本人手牌或牌力分析。"""
    if layout == 'observer':
        value['queue'] = public_events(value['queue'])


def public_events(queue):
    """保留旁观者可接收的事件及其原始顺序。"""
    return [event for event in queue if event['event'] not in ('hand_card', 'hand_analyse')]


def zhajinhua_operation(operating, seen, opponent):
    """本人看牌时下注翻倍，对手操作时保留盲注。"""
    operating['player_id'] = PLAYERS[0] if opponent else '@self'
    if all((seen, not opponent)):
        operating['valid_bets'] = {'fold': {}, 'call': {'amount': 20}, 'challenge': {'amount': 40},
            'raise': {'minimum': 40, 'maximum': 200, 'step': 20}, 'all_in': {'amount': 1000}}


def zhajinhua_table(value, operating, parameters):
    """构造炸金花看牌状态，保留手牌消息插入位置。"""
    validate_parameters(parameters, {'turn', 'cards'}, {
        'turn': ('self', ('self', 'opponent')), 'cards': ('blind', ('blind', 'seen'))})
    seen = parameters.get('cards') == 'seen'
    if seen:
        value['queue'].insert(2, {'event': 'hand_card', 'player_id': '@self',
            'hole_card': ['as', 'ad', 'ac'], 'hand_strength': 'three_of_a_kind'})
    for status in table_statuses(value['queue']):
        status['seats'][0]['player']['is_seen_card'] = seen
    zhajinhua_operation(operating, seen, parameters.get('turn') == 'opponent')
