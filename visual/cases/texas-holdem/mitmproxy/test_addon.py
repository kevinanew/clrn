"""验证德州代理的控制鉴权和 HTTP 回放范围，不访问真实服务。"""

import json
import unittest
from unittest.mock import patch

from test_texas_replay import flow, ROOM, OTHER, SELF
from texas_replay import PLAYER_IDS
from addon import TexasVisualProxy


class TexasAddonTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.room_id = ROOM
        self.addon.texas.self_id = SELF

    def request(self, path, method='GET', body=None, host='api.shafayouxi.org'):
        request = flow(f'https://{host}{path}', method,
                       b'' if body is None else json.dumps(body).encode())
        self.addon.request(request)
        return request

    def test_read_fixtures_do_not_hide_mutations_or_other_users(self):
        player = PLAYER_IDS[0]
        for path in (f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
                     f'/v1/texas_statistics/player/{player}/rounds/100'):
            self.assertIsNotNone(self.request(path).response)
            for method in ('PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
                self.assertIsNone(self.request(path, method).response)
        self.assertIsNone(self.request(f'/v10/profile/{OTHER}').response)
        self.assertIsNone(self.request('/v10/profile/users', 'PUT', {'users': [player, OTHER]}).response)
        profiles = self.request('/v10/profile/users', 'PUT', {'users': [player, SELF]})
        self.assertEqual(set(json.loads(profiles.response.content)['result']), {player, SELF})

    def test_block_fixture_only_intercepts_replay_players_and_known_methods(self):
        path = '/v1/hall_matching/blacklist'
        for method in ('POST', 'DELETE'):
            self.assertIsNotNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)
            self.assertIsNone(self.request(path, method, {'black_user_id': OTHER}).response)
            self.assertIsNone(self.request(path, method, []).response)
        for method in ('GET', 'PUT', 'OPTIONS'):
            self.assertIsNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)

    def test_production_hosts_and_disabled_scenarios_always_pass_through(self):
        paths = ('/public/v13/metadata/servers', '/node/v1/status',
                 f'/v10/profile/{PLAYER_IDS[0]}')
        for path in paths:
            self.assertIsNone(self.request(path, host='production.example.com').response)
            self.assertIsNone(self.request(path, host='api.staging.laiwan.shafayouxi.com.evil.test').response)
        self.addon.scenario = None
        for path in paths:
            self.assertIsNone(self.request(path).response)

    def test_malformed_or_unauthorized_control_cannot_change_replay(self):
        for body in (b'[]', b'null', b'{', b'{}', b'{"scenario":"club-failure"}'):
            request = flow('http://test-mitmproxy.invalid/scenario', 'POST', body, 'test-token')
            self.addon.request(request)
            self.assertEqual(request.response.status_code, 400)
            self.assertEqual(self.addon.texas.room_id, ROOM)
        unauthorized = flow('http://test-mitmproxy.invalid/scenario', 'POST', b'{"scenario":null}')
        self.addon.request(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertEqual(self.addon.texas.room_id, ROOM)


if __name__ == '__main__':
    unittest.main()
