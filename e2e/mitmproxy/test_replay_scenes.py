"""固定消息场景的语义、顺序和参数边界；不依赖浏览器或线上账号。"""

import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from replay_scenes import DATA, replay_scene, publish_scene

SELF = '33333333-3333-4333-8333-333333333333'
ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'


class ReplaySceneTests(unittest.TestCase):
    def scene(self, game='texas', name='restore', **parameters):
        return replay_scene(game, {'scene': name, 'parameters': parameters}, SELF)

    def test_texas_streets_preserve_order_cards_seats_and_owner(self):
        for street, cards, pots in (('preflop', [], [6]), ('flop', ['ah', 'kd', '7c'], [120, 60]),
                                    ('river', ['ah', 'kd', '7c', '2s', 'qs'], [120, 60])):
            body = self.scene(street=street)
            self.assertEqual(body['stream'], 'texas_holdem')
            queue = body['queue']
            self.assertEqual([item['event'] for item in queue], [
                'room_status', 'game_status', 'table_status', 'hand_card', 'operating_player_status', 'hand_analyse'])
            self.assertEqual(queue[0]['status']['state'], 'running')
            self.assertEqual(queue[1]['status']['state'], 'gaming')
            self.assertEqual(queue[2]['status']['community_card'], cards)
            self.assertEqual(queue[2]['status']['pots'], pots)
            self.assertEqual(sum(seat['player'] is not None for seat in queue[2]['status']['seats']), 5)
            self.assertEqual(queue[3]['player_id'], SELF)
            self.assertEqual(queue[4]['status']['player_id'], SELF)
            self.assertNotIn('@self', json.dumps(body))

    def test_layouts_keep_full_table_side_pots_and_observer_without_private_hand(self):
        full = self.scene(layout='full-pots')['queue'][2]['status']
        self.assertEqual(sum(seat['player'] is not None for seat in full['seats']), 9)
        self.assertEqual(full['pots'], [90, 80, 70, 60, 50, 40, 30, 20, 10])
        self.assertEqual(full['seats'][0]['position'], 'BTN')
        observer = self.scene(layout='observer')['queue']
        self.assertNotIn('hand_card', [item['event'] for item in observer])
        self.assertNotIn('hand_analyse', [item['event'] for item in observer])
        players = [seat['player']['player_id'] for seat in observer[2]['status']['seats'] if seat['player']]
        self.assertEqual(len(players), 4)
        self.assertNotIn(SELF, players)
        self.assertEqual(observer[-1]['status']['player_id'], players[0])
        for layout, expected in (('check', {'fold', 'check', 'raise', 'all_in'}),
                                  ('all-in-only', {'fold', 'all_in'}), ('all-in-call', {'fold', 'call', 'all_in'})):
            self.assertEqual(set(self.scene(layout=layout)['queue'][4]['status']['valid_bets']), expected)
        self.assertEqual(self.scene(layout='shortcut-blinds')['queue'][2]['status']['pots'], [3])
        self.assertEqual(self.scene(layout='shortcut-disabled')['queue'][4]['status']['valid_bets']['raise']['maximum'], 50)

    def test_zhajinhua_seen_cards_double_own_bets_and_keep_opponent_blind(self):
        for turn in ('self', 'opponent'):
            seen = self.scene('zhajinhua', cards='seen', turn=turn)['queue']
            self.assertEqual([event['event'] for event in seen], [
                'room_status', 'game_status', 'hand_card', 'operating_player_status', 'table_status'])
            self.assertEqual(seen[2]['hole_card'], ['as', 'ad', 'ac'])
            self.assertEqual(seen[3]['status']['valid_bets']['call']['amount'], 20 if turn == 'self' else 10)
            self.assertEqual(seen[4]['status']['seats'][0]['player']['is_seen_card'], True)
        blind = self.scene('zhajinhua')['queue']
        self.assertNotIn('hand_card', [event['event'] for event in blind])
        self.assertEqual(blind[2]['status']['valid_bets']['call']['amount'], 10)

    def test_countdown_keeps_snapshot_timer_and_changes_only_live_operation_limit(self):
        for game in ('texas', 'zhajinhua'):
            queue = self.scene(game, 'countdown')['queue']
            for event in queue:
                if event['event'] in ('room_status', 'game_status'):
                    self.assertEqual(event['status']['operating_seconds'], 12)
                if event['event'] == 'operating_player_status':
                    self.assertEqual(event['status']['remain_operating_seconds'], 120)
            self.assertEqual(self.scene(game, 'room-running')['queue'], [self.scene(game)['queue'][0]])

    def test_catalogs_are_used_and_all_parameter_choices_resolve_without_mutating_files(self):
        source = '\n'.join(path.read_text() for folder in ('animations', 'cases')
                           for path in (Path(__file__).resolve().parents[2] / 'visual' / folder).rglob('*.ts'))
        for game in ('texas', 'zhajinhua'):
            file = DATA / f'{game}-replay.json'
            original = file.read_bytes()
            for name, template in json.loads(original).items():
                self.assertIn("'" + name + "'", source, f'未调用的夹具应删除: {name}')
                raw, parameters = json.dumps(template), {}
                if '@street' in raw:
                    parameters['street'] = 'flop'
                if '@action' in raw:
                    parameters['action'] = 'sticker' if '@file' in raw else 'call'
                if '@file' in raw:
                    parameters['file'] = 'angry'
                body = self.scene(game, name, **parameters)
                self.assertNotIn('@', json.dumps(body))
                self.assertEqual(file.read_bytes(), original)

    def test_response_payloads_unknown_scenes_and_unbounded_parameters_are_rejected(self):
        for command in (None, [], {'stream': 'texas_holdem', 'queue': []},
                        {'scene': 'restore', 'queue': []}, {'scene': '../data'},
                        {'scene': 'restore', 'parameters': {'validBets': {}}},
                        {'scene': 'restore', 'parameters': {'street': 'unknown'}},
                        {'scene': 'restore', 'parameters': {'street': []}},
                        {'scene': 'countdown', 'parameters': {'street': 'river'}},
                        {'scene': 'texas-assets-room_message-@action',
                         'parameters': {'action': 'props', 'file': 'arbitrary'}}):
            with self.subTest(command=command), self.assertRaises(ValueError):
                replay_scene('texas', command, SELF)

    def test_publish_requires_one_confirmed_live_owner_and_keeps_direction_in_existing_replay(self):
        socket = SimpleNamespace(websocket=SimpleNamespace(timestamp_end=None))
        replay = SimpleNamespace(subscriptions={}, self_id=None, publish=Mock())
        command = {'scene': 'restore'}
        with self.assertRaises(ValueError):
            publish_scene(replay, ROOM, command, 'texas')
        replay.subscriptions['socket'] = (socket, {f'texas_holdem>{OTHER}#{SELF}'})
        with self.assertRaises(ValueError):
            publish_scene(replay, ROOM, command, 'texas')
        channels = {f'texas_holdem>{ROOM}#{SELF}'}
        replay.subscriptions['socket'] = (socket, channels)
        replay.self_id = OTHER
        with self.assertRaises(ValueError):
            publish_scene(replay, ROOM, command, 'texas')
        replay.self_id = SELF
        publish_scene(replay, ROOM, command, 'texas')
        self.assertEqual(replay.publish.call_args.args[0], ROOM)
        self.assertEqual(replay.publish.call_args.args[1]['queue'][3]['player_id'], SELF)
        channels.add(f'texas_holdem>{ROOM}#{OTHER}')
        with self.assertRaises(ValueError):
            publish_scene(replay, ROOM, command, 'texas')
        channels.remove(f'texas_holdem>{ROOM}#{OTHER}')
        socket.websocket.timestamp_end = 1
        with self.assertRaises(ValueError):
            publish_scene(replay, ROOM, command, 'texas')


if __name__ == '__main__':
    unittest.main()
