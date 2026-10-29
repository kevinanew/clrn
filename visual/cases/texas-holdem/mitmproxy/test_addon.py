"""验证德州代理的控制鉴权和 HTTP 回放范围，不访问真实服务。"""

import asyncio
import json
import unittest
from unittest.mock import patch
from mitmproxy import http

from test_texas_replay import flow, socket_flow, message, CHANNEL, ROOM, OTHER, SELF
from texas_replay import PLAYER_IDS
from addon import TexasVisualProxy
with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from scenario_fixtures import ScenarioFixtures

from test_network_faults import source_environment


class TexasAddonTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.room_id = ROOM
        self.addon.texas.self_id = SELF

    def request(self, path, method='GET', body=None, host='node-0.service.invalid'):
        request = flow(f'https://{host}{path}', method,
                       b'' if body is None else json.dumps(body).encode())
        self.addon.request(request)
        return request

    def test_回放绑定实际订阅房间而不依赖固定节点(self):
        for host in ('candidate-0', 'candidate-1', 'candidate-2'):
            with self.subTest(host=host), patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
                addon = TexasVisualProxy()
                addon.scenario = 'visual-stable'
                selected_socket = socket_flow()
                selected_socket.request.host = host + '.node-18.service.invalid'
                message(selected_socket, [{'id': 1, 'method': 1, 'params': {'channel': CHANNEL}}])
                addon.websocket_message(selected_socket)
                message(selected_socket, [{'id': 1, 'result': {}}], False)
                addon.websocket_message(selected_socket)
                with patch('texas_replay.ctx.master', create=True) as master:
                    addon.texas.publish(ROOM, {'stream': 'texas_holdem', 'queue': []})
                    injected_arguments = master.commands.call.call_args.args
                    self.assertEqual(injected_arguments[:3], ('inject.websocket', selected_socket, True))
                    self.assertEqual(json.loads(injected_arguments[3])['result']['channel'], CHANNEL)
                    with self.assertRaises(ValueError):
                        addon.texas.publish(OTHER, {})

    def test_只读夹具不掩盖写入或其他用户(self):
        player = PLAYER_IDS[0]
        for path in (f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
                     f'/v1/texas_statistics/player/{player}/rounds/100'):
            self.assertIsNotNone(self.request(path).response)
            for method in ('PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
                self.assertIsNone(self.request(path, method).response)
        self.assertIsNone(self.request(f'/v10/profile/{OTHER}').response)
        self.assertIsNone(self.request('/v10/profile/users', 'PUT', {'users': [player, OTHER]}).response)
        profiles = self.request('/v10/profile/users', 'PUT', {'users': [player, SELF]})
        self.assertIsNone(profiles.response)
        original = {'ok': True, 'new_metadata': 'kept', 'result': {
            SELF: {'nickname': 'Real user', 'new_field': 42}}}
        profiles.response = http.Response.make(200, json.dumps(original).encode())
        self.addon.response(profiles)
        result = profiles.response.json()
        self.assertEqual(result['result'][SELF], original['result'][SELF])
        self.assertEqual(result['result'][player]['nickname'], 'Player1')
        self.assertEqual(result['new_metadata'], 'kept')
        for path in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin',
                     f'/v1/texas_statistics/player/{SELF}/rounds/100'):
            self.assertIsNone(self.request(path).response)

    def test_屏蔽夹具只匹配回放玩家与已知方法(self):
        path = '/v1/hall_matching/blacklist'
        for method in ('POST', 'DELETE'):
            self.assertIsNotNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)
            self.assertIsNone(self.request(path, method, {'black_user_id': OTHER}).response)
            self.assertIsNone(self.request(path, method, []).response)
        for method in ('GET', 'PUT', 'OPTIONS'):
            self.assertIsNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)

    def test_其他环境来源与关闭场景始终透传(self):
        paths = ('/public/v13/metadata/servers', '/node/v1/status',
                 f'/v10/profile/{PLAYER_IDS[0]}')
        for path in paths:
            self.assertIsNone(self.request(path, host='node-9.service.invalid').response)
            self.assertIsNone(self.request(path, host='node-17.service.invalid').response)
        self.addon.scenario = None
        for path in paths:
            self.assertIsNone(self.request(path).response)

    def test_损坏或未认证控制不能改变回放(self):
        for body in (b'[]', b'null', b'{', b'{}', b'{"scenario":"club-failure"}'):
            request = flow('http://test-mitmproxy.invalid/scenario', 'POST', body, 'test-token')
            self.addon.request(request)
            self.assertEqual(request.response.status_code, 400)
            self.assertEqual(self.addon.texas.room_id, ROOM)
        unauthorized = flow('http://test-mitmproxy.invalid/scenario', 'POST', b'{"scenario":null}')
        self.addon.request(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertEqual(self.addon.texas.room_id, ROOM)

    def test_新版战绩控制必须认证且可释放(self):
        path = '/public/v11/game_log/available.json'
        unauthorized = flow('http://test-mitmproxy.invalid/texas/records', 'POST', b'{"empty":true}')
        self.addon.request(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertFalse(self.addon.records.enabled)
        for body in (b'{}', b'[]', b'{"empty":"true"}'):
            invalid = flow('http://test-mitmproxy.invalid/texas/records', 'POST', body, 'test-token')
            self.addon.request(invalid)
            self.assertEqual(invalid.response.status_code, 400)
            self.assertFalse(self.addon.records.enabled)
        valid = flow('http://test-mitmproxy.invalid/texas/records', 'POST', b'{"empty":true}', 'test-token')
        self.addon.request(valid)
        self.assertEqual(valid.response.status_code, 200)
        version = self.request(path)
        self.assertIsNone(version.response)
        version.response = http.Response.make(200, b'{"ok":true,"result":{"available_url_version":"v1","extra":1}}')
        self.addon.response(version)
        self.assertEqual(version.response.json()['result'], {'available_url_version': 'v11', 'extra': 1})
        self.assertIsNone(self.request(path, host='node-9.service.invalid').response)
        release = flow('http://test-mitmproxy.invalid/texas/release', 'POST', b'{}', 'test-token')
        self.addon.request(release)
        self.assertFalse(self.addon.records.enabled)
        self.assertIsNone(self.request(path).response)


class CombinedSceneTests(unittest.IsolatedAsyncioTestCase):
    async def test_共用闸门优先生效且释放后仍隔离写入(self):
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            common, game = ScenarioFixtures(), TexasVisualProxy()
        game.scenario = 'visual-stable'
        game.texas.arm_created_room(ROOM, SELF)
        common.user_id = SELF
        creation = flow('https://node-0.service.invalid/v3/pay_action/do', 'POST', json.dumps({
            'user_id': SELF, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': 'texas_react_native'}}).encode())
        creation.response = http.Response.make(200, json.dumps({'ok': True, 'result': {'room_id': ROOM}}).encode())
        common.response(creation)
        async def select(phase):
            command = flow('http://fixtures-mitmproxy.invalid/fixtures/select', 'POST', json.dumps({
                'name': 'auto-rebuy', 'roomId': ROOM, 'phase': phase}).encode(), 'test-token')
            await common.request(command)
            game.request(command)
            self.assertEqual(command.response.status_code, 200)
        async def request():
            target = flow(f'https://node-0.service.invalid/v10/texas_holdem/room/{ROOM}/user_settings/enable_auto_rebuy', 'PUT')
            await common.request(target)
            game.request(target)
            return target
        await select('hold')
        task = asyncio.create_task(request())
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertEqual(common.held, 1)
        await select('release')
        self.assertEqual((await asyncio.wait_for(task, 1)).response.json(), {'ok': True, 'result': {'auto_rebuy': True}})
        self.assertIsNotNone((await request()).response)


if __name__ == '__main__':
    unittest.main()
