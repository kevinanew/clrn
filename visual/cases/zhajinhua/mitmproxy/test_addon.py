"""验证真实创建响应、回放归属和 HTTP 边界，避免误操作其他房间。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import http
from test_zhajinhua_replay import flow, socket_flow, message, CHANNEL, ROOM, OTHER, SELF
from replay_scenes import replay_scene
from zhajinhua_replay import PLAYER_IDS
from addon import ZhajinhuaVisualProxy

from test_network_faults import source_environment


class ZhajinhuaAddonTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = ZhajinhuaVisualProxy()
        self.addon.scenario = 'visual-stable'

    def creation(self, game_type='zhajinhua', ok=True, room=ROOM, host='node-0.service.invalid', method='POST'):
        request = flow(f'https://{host}/v3/pay_action/do', method, json.dumps({
            'user_id': SELF, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': game_type},
        }).encode())
        request.response = http.Response.make(200, json.dumps({'ok': ok, 'result': {'room_id': room}}).encode())
        self.addon.response(request)

    def control(self, path, body, token='test-token'):
        request = flow(f'http://test-mitmproxy.invalid{path}', 'POST', json.dumps(body).encode(), token)
        self.addon.request(request)
        return request

    def test_仅成功创建拼三张房间才能绑定回放(self):
        for kwargs in ({'game_type': 'texas_react_native'}, {'ok': False}, {'room': '123456'},
                       {'host': 'node-9.service.invalid'}, {'method': 'PUT'}):
            self.creation(**kwargs)
            self.assertIsNone(self.addon.created_room_id)
        self.creation()
        self.assertEqual(self.addon.created_room_id, ROOM)
        self.creation(room=OTHER)
        self.assertEqual(self.addon.created_room_id, ROOM)
        # 开局前观察流量仍真实；首次回放之前不隔离状态查询。
        self.assertIsNone(self.addon.replay.room_id)

    def test_回放必须绑定已创建房间且控制已认证(self):
        payload = {'roomId': ROOM, 'scene': {'scene': 'restore'}}
        self.assertEqual(self.control('/zhajinhua/replay', payload).response.status_code, 400)
        self.creation()
        self.assertEqual(self.control('/zhajinhua/replay', payload, None).response.status_code, 403)
        self.assertEqual(self.control('/zhajinhua/replay', payload).response.status_code, 400)
        socket = socket_flow()
        message(socket, [{'id': 1, 'method': 1, 'params': {'channel': CHANNEL}}])
        self.addon.websocket_message(socket)
        message(socket, [{'id': 1, 'result': {}}], False)
        self.addon.websocket_message(socket)
        with patch.object(self.addon.replay, 'publish') as publish:
            self.assertEqual(self.control('/zhajinhua/replay', dict(payload, roomId=OTHER)).response.status_code, 400)
            publish.assert_not_called()
            self.assertEqual(self.control('/zhajinhua/replay', payload).response.status_code, 200)
            published_room, published = publish.call_args.args
            self.assertEqual(published_room, ROOM)
            self.assertEqual(published['queue'], replay_scene('zhajinhua', payload['scene'], SELF)['queue'])
            for invalid in ({'roomId': ROOM, 'data': {'stream': 'zhajinhua', 'queue': []}},
                            dict(payload, data={}), dict(payload, scene={'scene': 'unknown'})):
                self.assertEqual(self.control('/zhajinhua/replay', invalid).response.status_code, 400)
        self.assertEqual(self.control('/texas/replay', payload).response.status_code, 400)
        self.control('/zhajinhua/release', {})
        self.assertIsNone(self.addon.created_room_id)
        self.assertIsNone(self.addon.replay.room_id)

    def test_空排行榜仅用于已创建房间的读取(self):
        path = f'/v1/game_log/room/{ROOM}/settlement'
        request = flow(f'https://node-0.service.invalid{path}')
        self.addon.request(request)
        self.assertIsNone(request.response)
        self.creation()
        for url, method in ((f'https://node-0.service.invalid{path}', 'POST'),
                            (f'https://node-0.service.invalid/v1/game_log/room/{OTHER}/settlement', 'GET'),
                            (f'https://node-9.service.invalid{path}', 'GET'),
                            ('https://node-0.service.invalid/node/v1/status', 'GET')):
            request = flow(url, method)
            self.addon.request(request)
            self.assertIsNone(request.response)
        request = flow(f'https://node-0.service.invalid{path}')
        self.addon.request(request)
        self.assertEqual(request.response.json(), {'ok': True, 'result': {'settlements': []}})
        self.control('/zhajinhua/release', {})
        request = flow(f'https://node-0.service.invalid{path}')
        self.addon.request(request)
        self.assertIsNone(request.response)

    def test_接口夹具保留写入其他用户与主机(self):
        self.addon.replay.room_id, self.addon.replay.self_id = ROOM, SELF
        path = f'/v10/profile/{PLAYER_IDS[0]}'
        for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
            request = flow(f'https://node-0.service.invalid{path}', method)
            self.addon.request(request)
            self.assertIsNone(request.response)
        for url in (f'https://node-9.service.invalid{path}',
                    f'https://node-0.service.invalid/v10/profile/{OTHER}',
                    f'https://node-17.service.invalid{path}'):
            request = flow(url)
            self.addon.request(request)
            self.assertIsNone(request.response)
        request = flow(f'https://node-0.service.invalid{path}')
        self.addon.request(request)
        self.assertEqual(json.loads(request.response.content)['result']['nickname'], 'Player1')

    def preflight(self, url=None, **headers):
        request = flow(url or f'https://node-0.service.invalid/v1/game_log/room/{ROOM}/settlement', 'OPTIONS')
        request.request.headers.update({'Origin': 'http://127.0.0.1:43210',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'app-id,app-version,authorization,content-type', **headers})
        self.addon.request(request)
        return request

    def test_空榜预检只允许当前房间与本轮页面的必要读取(self):
        self.creation()
        with patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': 'http://127.0.0.1:43210/'}):
            request = self.preflight()
            self.assertEqual(request.response.status_code, 204)
            self.assertEqual(request.response.content, b'')
            self.assertEqual(request.response.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:43210')
            self.assertEqual(request.response.headers['Access-Control-Allow-Methods'], 'GET')
            self.assertEqual(request.response.headers['Access-Control-Allow-Headers'],
                             'app-id,app-version,authorization,content-type')
            self.assertEqual(request.response.headers['Access-Control-Allow-Credentials'], 'true')
            self.assertEqual(self.preflight(**{'Access-Control-Request-Headers': ' Authorization, CONTENT-TYPE '})
                             .response.status_code, 204, '请求头名称不区分大小写')

    def test_其他来源方法请求头场景与未绑定房间的预检保持透传(self):
        with patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': 'http://127.0.0.1:43210'}):
            self.assertIsNone(self.preflight().response, '未观察到成功建房时不能放行')
            self.creation()
            for headers in ({'Origin': ''}, {'Origin': 'null'}, {'Origin': 'http://127.0.0.1:43211'},
                            {'Origin': 'https://page.invalid'}, {'Access-Control-Request-Method': ''},
                            {'Access-Control-Request-Method': 'POST'}, {'Access-Control-Request-Method': 'get'},
                            {'Access-Control-Request-Headers': ''},
                            {'Access-Control-Request-Headers': 'authorization,x-unknown'},
                            {'Access-Control-Request-Headers': 'authorization,,content-type'}):
                with self.subTest(headers=headers):
                    self.assertIsNone(self.preflight(**headers).response)
            for url in (f'https://node-9.service.invalid/v1/game_log/room/{ROOM}/settlement',
                        f'https://node-0.service.invalid/v1/game_log/room/{OTHER}/settlement',
                        f'https://node-0.service.invalid/v1/game_log/room/{ROOM}/settlement/extra',
                        f'https://node-0.service.invalid/v10/profile/{PLAYER_IDS[0]}'):
                self.assertIsNone(self.preflight(url).response)
            self.addon.scenario = None
            self.assertIsNone(self.preflight().response)
            self.addon.scenario = 'visual-stable'
            self.control('/zhajinhua/release', {})
            self.assertIsNone(self.preflight().response, '释放当前房间后不能沿用预检许可')

    def test_本轮页面来源配置缺失损坏或带凭据时预检保持透传(self):
        self.creation()
        for configured in ('', 'invalid', 'http://127.0.0.1:bad', 'http://127.0.0.1',
                           'https://page.invalid', 'http://token@127.0.0.1:43210',
                           'http://127.0.0.1:43210/other', 'http://127.0.0.1:43210?token=offline'):
            with self.subTest(configured=configured), patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': configured}):
                self.assertIsNone(self.preflight().response)

    def test_本人资料保持真实且混合批次仅补充虚拟对手(self):
        self.addon.replay.room_id, self.addon.replay.self_id = ROOM, SELF
        for path in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin'):
            request = flow('https://node-0.service.invalid' + path)
            self.addon.request(request)
            self.assertIsNone(request.response)
        player = PLAYER_IDS[0]
        request = flow('https://node-0.service.invalid/v10/profile/users', 'PUT',
                       json.dumps({'users': [SELF, player]}).encode())
        self.addon.request(request)
        self.assertIsNone(request.response)
        self.assertEqual(request.request.json()['users'], [SELF])
        real = {'nickname': 'Real name', 'new_field': 42}
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {SELF: real}}).encode())
        self.addon.response(request)
        self.assertEqual(request.response.json()['result'][SELF], real)
        self.assertEqual(request.response.json()['result'][player]['nickname'], 'Player1')


if __name__ == '__main__':
    unittest.main()
