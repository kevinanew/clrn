"""只回放当前隔离房间和当前用户的一局战绩，不替换其他游戏日志。"""

import json
from texas_replay import PLAYER_IDS

GAME_ID = 'visual-fixed-game'
CARDS = ['ah', 'kd', '7c', '2s', 'qs']


def game(self_id):
    """构造绑定当前玩家的德州摊牌重放事件序列。"""
    players = [
        {'player_id': self_id, 'seat_number': 1, 'position': 'D', 'stack': 1000},
        {'player_id': PLAYER_IDS[0], 'seat_number': 2, 'position': 'SB', 'stack': 1000}]
    showdown = [dict(players[0], hole_card=['as', 'ad'], strength_cards=['as', 'ad', 'ah'],
                     hand_strength='three_of_a_kind', is_max_strength=True),
                dict(players[1], hole_card=['kh', 'ks'], strength_cards=['kh', 'ks', 'kd'],
                     hand_strength='three_of_a_kind', is_max_strength=False)]
    return {'game_id': GAME_ID, 'game_at': '2026-01-01T12:00:00Z', 'actions': [
        {'action_name': 'begin_play', 'game': {'variation': 'texas_holdem'}, 'table': {'players': players}},
        {'action_name': 'deal_hole_card', 'player_id': self_id, 'hole_card': ['as', 'ad']},
        {'action_name': 'small_blind', 'player_id': PLAYER_IDS[0], 'amount': 1, 'stack': 999},
        {'action_name': 'big_blind', 'player_id': self_id, 'amount': 2, 'stack': 998},
        {'action_name': 'call', 'player_id': PLAYER_IDS[0], 'amount': 20, 'stack': 979},
        {'action_name': 'pots_updated', 'pots': [180]},
        {'action_name': 'start_street', 'street': 'river', 'community_card': CARDS},
        {'action_name': 'check', 'player_id': self_id},
        {'action_name': 'showdown', 'players': showdown},
        {'action_name': 'settlement', 'players': [dict(players[0], net=180), dict(players[1], net=-180)]}]}


def fixture(path, method, content, room_id, self_id):
    """只为已绑定房间和用户提供日志。"""
    if not room_id or not self_id:
        return None
    return room_fixture(path, method, content, room_id, self_id)


def room_fixture(path, method, content, room_id, self_id):
    """结算 GET 和日志 PUT 分开处理，保持正文解析时机。"""
    if method == 'GET' and path == f'/v1/game_log/room/{room_id}/settlement':
        return {'settlements': settlement_players(self_id)}
    return write_fixture(path, method, content, room_id, self_id)


def settlement_players(self_id):
    """保持当前玩家和四个虚拟对手的结算数据。"""
    return [{'user_id': player_id, 'buy_in_amount': 1000, 'game_round_amount': 10,
             'settlement_amount': 180 if index == 0 else -180}
            for index, player_id in enumerate([self_id, *PLAYER_IDS])]


def write_fixture(path, method, content, room_id, self_id):
    """只对 PUT 解析正文。"""
    if method != 'PUT':
        return None
    body = json.loads(content or b'{}')
    return log_request(path, body, room_id, self_id)


def log_request(path, body, room_id, self_id):
    """固定请求路径和值对应固定日志响应。"""
    routes = {
        # 房间计数只在固定批次校验后生成。
        '/v1/game_log/room/game_amount': ('room_ids', [room_id], lambda: {
            'results': [{'room_id': room_id, 'game_amount': 1}]}),
        # 局号列表只在请求匹配后构造。
        f'/v1/game_log/room/{room_id}/game': ('game_numbers', [1], lambda: {'results': [{'game_id': GAME_ID}]}),
        # 重放数据在固定 game_ids 校验后构造。
        f'/v1/game_log/user/{self_id}/games': ('game_ids', [GAME_ID], lambda: {'results': [game(self_id)]}),
    }
    route = routes.get(path)
    if route is not None:
        return matched_result(body, *route)
    return None


def matched_result(body, key, expected, build):
    """批次必须与固定查询完全相同。"""
    if body.get(key) == expected:
        return build()
    return None
