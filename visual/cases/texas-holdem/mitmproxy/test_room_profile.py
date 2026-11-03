"""验证规则响应来自真实读取，且只在当前回放房间和认证范围内复用。"""

import json
import unittest
from mitmproxy import http
import test_addon
from test_texas_replay import ROOM, OTHER, SELF, flow


class RoomProfileTests(unittest.TestCase):
    def setUp(self):
        test_addon.TexasAddonTests.setUp(self)

    def profile_request(self, room=ROOM, token='Bearer real-session', origin='https://web.invalid',
                        method='GET', host='node-0.service.invalid', suffix=''):
        request = flow(f'https://{host}/v10/texas_holdem/room/{room}/profile{suffix}', method)
        request.request.headers['Authorization'] = token
        request.request.headers['Origin'] = origin
        self.addon.request(request)
        return request

    def record(self, body=None, status=200, **options):
        request = self.profile_request(**options)
        self.assertIsNone(request.response, '首次读取必须到真实上游')
        data = body if body is not None else {'ok': True, 'result': {
            'all_time_based_rule': [{'small_blind': 10, 'big_blind': 20}], 'extra': 'preserved'}}
        request.response = http.Response.make(status, json.dumps(data).encode())
        self.addon.response(request)
        return data

    def test_成功规则读取原样复用且保留当前来源的跨域头(self):
        data = self.record()
        for host in ('node-0.service.invalid', 'candidate-0.node-18.service.invalid'):
            request = self.profile_request(host=host)
            self.assertIsNotNone(request.response)
            self.assertEqual(request.response.json(), data)
            self.assertEqual(request.response.headers['Access-Control-Allow-Origin'], 'https://web.invalid')

    def test_错误与不完整规则不能被补为成功(self):
        for status, body in [(503, {'ok': True, 'result': {'all_time_based_rule': []}}),
                             (200, {'ok': False, 'error': 'denied'}),
                             (200, {'ok': True, 'result': {}}),
                             (200, {'ok': True, 'result': {'all_time_based_rule': None}}),
                             (200, [])]:
            with self.subTest(status=status, body=body):
                self.record(body, status)
                self.assertIsNone(self.profile_request().response)
        request = self.profile_request()
        request.response = http.Response.make(200, b'invalid json')
        self.addon.response(request)
        self.assertIsNone(self.profile_request().response)

    def test_其他认证来源房间方法主机和查询必须透传(self):
        self.record()
        for options in ({'token': 'Bearer different'}, {'token': ''}, {'token': 'Bearer '},
                        {'origin': 'https://other.invalid'}, {'room': OTHER},
                        {'host': 'unconfigured.invalid'}, {'suffix': '?fresh=true'},
                        *({'method': method} for method in ('OPTIONS', 'POST', 'PUT', 'DELETE'))):
            with self.subTest(options=options):
                self.assertIsNone(self.profile_request(**options).response)

    def test_释放场景或更换房间玩家后必须重新真实读取(self):
        for change in ('release', 'scenario', 'room', 'self'):
            with self.subTest(change=change):
                self.addon.texas.room_id, self.addon.texas.self_id = ROOM, SELF
                self.record()
                if change in ('release', 'scenario'):
                    path = '/texas/release' if change == 'release' else '/scenario'
                    body = {} if change == 'release' else {'scenario': 'visual-stable'}
                    command = flow('http://test-mitmproxy.invalid' + path, 'POST',
                                   json.dumps(body).encode(), 'test-token')
                    self.addon.request(command)
                    self.assertEqual(command.response.status_code, 200)
                    self.addon.texas.room_id, self.addon.texas.self_id = ROOM, SELF
                elif change == 'room':
                    self.addon.texas.room_id = OTHER
                else:
                    self.addon.texas.self_id = OTHER
                self.assertIsNone(self.profile_request().response)
                self.addon.room_profile.release()
