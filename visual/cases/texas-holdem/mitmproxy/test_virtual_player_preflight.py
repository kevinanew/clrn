"""验证虚拟玩家读取预检的来源、方法和回放归属边界。"""

import unittest
from unittest.mock import patch
from addon import TexasVisualProxy
from texas_replay import TABLE_PLAYER_IDS
from test_texas_replay import flow, ROOM, OTHER, SELF
from test_network_faults import source_environment


class VirtualPlayerPreflightTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(source_environment())
        self.enterContext(patch.dict('os.environ', {
            'MITMPROXY_CONTROL_TOKEN': 'test-token',
            'CLRN_RELEASE_WEB_URL': 'http://127.0.0.1:43210/',
        }))
        self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.arm_created_room(ROOM, SELF)

    def preflight(self, path=None, host='node-0.service.invalid', **headers):
        request = flow(f'https://{host}{path or "/v10/profile/" + TABLE_PLAYER_IDS[0]}', 'OPTIONS')
        request.request.headers.update({
            'Origin': 'http://127.0.0.1:43210',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'app-id,app-version,authorization,content-type', **headers,
        })
        self.addon.request(request)
        return request

    def test_已有虚拟玩家资料钱包及统计读取具有对应预检且不依赖上游(self):
        for player in TABLE_PLAYER_IDS:
            for path in (f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
                         f'/v1/texas_statistics/player/{player}/rounds/100',
                         f'/v1/texas_statistics/player/{player}/rounds/1000'):
                with self.subTest(path=path):
                    request = self.preflight(path)
                    self.assertEqual(request.response.status_code, 204)
                    self.assertEqual(request.response.content, b'')
                    self.assertEqual(request.response.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:43210')
                    self.assertEqual(request.response.headers['Access-Control-Allow-Methods'], 'GET')
                    self.assertEqual(request.response.headers['Access-Control-Allow-Credentials'], 'true')
                    self.assertEqual(request.response.headers['Access-Control-Allow-Headers'],
                                     'app-id,app-version,authorization,content-type')
                    read = flow(f'https://node-0.service.invalid{path}')
                    self.addon.request(read)
                    self.assertEqual(read.response.json(), {'ok': True, 'result': self.addon.texas.http_fixture(path)})
        self.assertEqual(self.preflight(**{'Access-Control-Request-Headers': ' Authorization, CONTENT-TYPE '})
                         .response.status_code, 204, '请求头名称不区分大小写')

    def test_真实用户写入节点探测及未登记路径的预检保持透传(self):
        for player in (SELF, OTHER):
            for path in (f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
                         f'/v1/texas_statistics/player/{player}/rounds/100'):
                self.assertIsNone(self.preflight(path).response)
        for path in ('/node/v1/status', '/v10/profile/users',
                     f'/v10/texas_holdem/room/{ROOM}/enter',
                     f'/v10/profile/{TABLE_PLAYER_IDS[0]}/extra',
                     f'/v1/texas_statistics/player/{TABLE_PLAYER_IDS[0]}/rounds/10'):
            self.assertIsNone(self.preflight(path).response)
        for headers in ({'Origin': ''}, {'Origin': 'null'}, {'Origin': 'http://127.0.0.1:43211'},
                        {'Origin': 'https://page.invalid'}, {'Access-Control-Request-Method': ''},
                        {'Access-Control-Request-Method': 'PUT'}, {'Access-Control-Request-Method': 'get'},
                        {'Access-Control-Request-Headers': ''},
                        {'Access-Control-Request-Headers': 'authorization,x-unknown'},
                        {'Access-Control-Request-Headers': 'authorization,,content-type'}):
            with self.subTest(headers=headers):
                self.assertIsNone(self.preflight(**headers).response)

    def test_其他主机场景及释放后的预检不沿用许可(self):
        self.assertIsNone(self.preflight(host='node-9.service.invalid').response)
        self.addon.scenario = None
        self.assertIsNone(self.preflight().response)
        self.addon.scenario = 'visual-stable'
        self.addon.texas.release()
        self.assertIsNone(self.preflight().response)

    def test_页面来源配置缺失损坏或带凭据时不处理预检(self):
        for configured in ('', 'invalid', 'http://127.0.0.1:bad', 'http://127.0.0.1',
                           'https://page.invalid', 'http://token@127.0.0.1:43210',
                           'http://127.0.0.1:43210/other', 'http://127.0.0.1:43210?token=offline'):
            with self.subTest(configured=configured), patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': configured}):
                self.assertIsNone(self.preflight().response)
