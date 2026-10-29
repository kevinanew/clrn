"""牌桌回放的固定数据和少量具名变体；控制端不能上传任意消息。"""

import copy
import json
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).with_name('data')
PLAYERS = [f'00000000-0000-4000-8000-{index:012d}' for index in range(1, 9)]
CARDS = ['ah', 'kd', '7c', '2s', 'qs']
STREETS = {'preflop': 0, 'flop': 3, 'turn': 4, 'river': 5}
LAYOUTS = {'standard', 'observer', 'full', 'full-pots', 'check', 'all-in-only',
           'all-in-call', 'shortcut-blinds', 'shortcut-disabled'}


def load(game, name):
    return json.loads((DATA / f'{game}-{name}.json').read_text())


def table(game, self_id, parameters):
    status = load(game, 'table')
    room_status = {**copy.deepcopy(status), 'state': 'running'}
    operating = {'player_id': '@self', 'remain_operating_seconds': 120}
    if game == 'texas':
        operating['valid_bets'] = {'fold': {}, 'call': {'amount': 20},
            'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}}
        queue = [{'event': 'room_status', 'status': room_status},
            {'event': 'game_status', 'game_id': 'visual-fixed-game', 'status': copy.deepcopy(status)},
            {'event': 'table_status', 'status': copy.deepcopy(status)},
            {'event': 'hand_card', 'player_id': '@self', 'hole_card': ['as', 'ad'], 'hand_strength': 'one_pair'},
            {'event': 'operating_player_status', 'status': operating}, {'event': 'hand_analyse', 'hand_power': 82}]
    else:
        operating['valid_bets'] = {'fold': {}, 'call': {'amount': 10}, 'challenge': {'amount': 20},
            'raise': {'minimum': 20, 'maximum': 100, 'step': 10}, 'all_in': {'amount': 1000}}
        queue = [{'event': 'room_status', 'status': room_status},
            {'event': 'game_status', 'game_id': 'visual-fixed-zhajinhua-game', 'status': copy.deepcopy(status)},
            {'event': 'operating_player_status', 'status': operating},
            {'event': 'table_status', 'status': copy.deepcopy(status)}]
    value = {'stream': 'texas_holdem' if game == 'texas' else game, 'queue': queue}
    if game == 'texas':
        if not set(parameters) <= {'street', 'turn', 'layout'}:
            raise ValueError('Unknown table parameters')
        street, turn, layout = (parameters.get('street', 'river'), parameters.get('turn', 'self'),
                                parameters.get('layout', 'standard'))
        if street not in STREETS or turn not in ('self', 'opponent') or layout not in LAYOUTS:
            raise ValueError('Unknown table scene')
        statuses = [event['status'] for event in value['queue'] if event['event'] in
                    ('room_status', 'game_status', 'table_status')]
        for status in statuses:
            status['street'] = street
            status['community_card'] = CARDS[:STREETS[street]]
            status['pots'] = [6] if street == 'preflop' else [120, 60]
            players = PLAYERS if layout == 'observer' else ['@self', *PLAYERS]
            if layout not in ('full', 'full-pots'):
                players = players[:4 if layout == 'observer' else 5]
            if layout in ('full', 'full-pots', 'observer'):
                positions = ['BTN', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO'] if layout != 'observer' else ['D', 'SB', 'BB', 'UTG', 'CO']
                for index, seat in enumerate(status['seats']):
                    occupied = index < len(players)
                    seat.update(state='occupied' if occupied else 'empty', position=positions[index] if index < len(positions) else '')
                    seat['player'] = ({'player_id': players[index], 'seat_number': index + 1,
                        'stack': 1000 - index * 40, 'buy_in': 1000, 'is_leave': False, 'is_playing': True,
                        'position': positions[index], 'last_action': {'name': 'fold' if index == 3 else 'call', 'amount': 20},
                        'public_hole_card': [], 'hole_card': []} if occupied else None)
            if layout == 'full-pots':
                status['pots'] = [90, 80, 70, 60, 50, 40, 30, 20, 10]
            if layout == 'shortcut-blinds':
                status['pots'] = [3]
        operating['player_id'] = PLAYERS[0] if turn == 'opponent' or layout == 'observer' else '@self'
        bets = {
            'check': {'fold': {}, 'check': {}, 'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}},
            'all-in-only': {'fold': {}, 'all_in': {'amount': 15}},
            'all-in-call': {'fold': {}, 'call': {'amount': 15}, 'all_in': {'amount': 15}},
            'shortcut-disabled': {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 50}, 'all_in': {'amount': 50}},
        }
        if layout in bets or layout == 'shortcut-blinds':
            operating['valid_bets'] = copy.deepcopy(bets['check' if layout == 'shortcut-blinds' else layout])
        if layout == 'observer':
            value['queue'] = [event for event in value['queue'] if event['event'] not in ('hand_card', 'hand_analyse')]
    else:
        if not set(parameters) <= {'turn', 'cards'} or parameters.get('turn', 'self') not in ('self', 'opponent') or parameters.get('cards', 'blind') not in ('blind', 'seen'):
            raise ValueError('Unknown table parameters')
        opponent, seen = parameters.get('turn') == 'opponent', parameters.get('cards') == 'seen'
        if seen:
            value['queue'].insert(2, {'event': 'hand_card', 'player_id': '@self',
                'hole_card': ['as', 'ad', 'ac'], 'hand_strength': 'three_of_a_kind'})
        for event in value['queue']:
            if event['event'] in ('room_status', 'game_status', 'table_status'):
                event['status']['seats'][0]['player']['is_seen_card'] = seen
            if event['event'] == 'operating_player_status':
                event['status']['player_id'] = PLAYERS[0] if opponent else '@self'
                if seen and not opponent:
                    call = 20
                    event['status']['valid_bets'] = {'fold': {}, 'call': {'amount': call},
                        'challenge': {'amount': call * 2}, 'raise': {'minimum': call * 2, 'maximum': call * 10, 'step': call},
                        'all_in': {'amount': 1000}}
    return replace(value, {'@self': self_id})


def replace(value, values):
    if isinstance(value, dict):
        return {key: replace(item, values) for key, item in value.items()}
    if isinstance(value, list):
        return [replace(item, values) for item in value]
    return values.get(value, value) if isinstance(value, str) else value


def replay_scene(game, command, self_id):
    if game not in ('texas', 'zhajinhua') or not isinstance(self_id, str) or not self_id:
        raise ValueError('Unknown game or owner')
    if not isinstance(command, dict) or not set(command) <= {'scene', 'parameters'}:
        raise ValueError('Only named replay scenes are accepted')
    name, parameters = command.get('scene'), command.get('parameters', {})
    if not isinstance(parameters, dict) or any(not isinstance(value, str) for value in parameters.values()):
        raise ValueError('Invalid parameters')
    if name in ('restore', 'countdown', 'room-running'):
        if name != 'restore' and parameters:
            raise ValueError('This scene has no parameters')
        value = table(game, self_id, parameters)
        if name == 'countdown':
            for event in value['queue']:
                if event['event'] in ('room_status', 'game_status'):
                    event['status']['operating_seconds'] = 12
        elif name == 'room-running':
            value['queue'] = value['queue'][:1]
    else:
        catalog = load(game, 'replay')
        if not isinstance(name, str) or name not in catalog:
            raise ValueError('Unknown replay scene')
        value = catalog[name]
        raw = json.dumps(value)
        required = {key for token, key in (('@street', 'street'), ('@cards', 'street'), ('@action', 'action'), ('@file', 'file')) if token in raw}
        if set(parameters) != required:
            raise ValueError('Invalid scene parameters')
        street, action, file = parameters.get('street'), parameters.get('action'), parameters.get('file')
        if street is not None and street not in ('flop', 'turn', 'river'):
            raise ValueError('Unknown street')
        if '@file' in raw:
            allowed = {'sticker': {'angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap'},
                       'props': {'tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer'}}
            if action not in allowed or file not in allowed[action]:
                raise ValueError('Unknown asset')
        elif action is not None and action not in ('call', 'raise', 'check', 'fold'):
            raise ValueError('Unknown action')
        value = replace(value, {'@self': self_id, '@street': street, '@cards': CARDS[:STREETS[street]] if street else [],
                                '@action': action, '@file': file})
    if 'queue' in value:
        value['sent_at'] = datetime.now(timezone.utc).isoformat()
    return value


def publish_scene(replay, room_id, command, game):
    """先确认真实订阅和用户，再生成消息；保留原有发布方向、队列和房间隔离。"""
    owners = {channel.rsplit('#', 1)[-1] for flow, channels in replay.subscriptions.values()
              if flow.websocket.timestamp_end is None for channel in channels
              if channel.startswith(f'{"texas_holdem" if game == "texas" else game}>{room_id}#')}
    if len(owners) != 1:
        raise ValueError('Expected one confirmed room owner')
    owner = owners.pop()
    if replay.self_id and replay.self_id != owner:
        raise ValueError('Another user owns this replay')
    replay.publish(room_id, replay_scene(game, command, owner))
