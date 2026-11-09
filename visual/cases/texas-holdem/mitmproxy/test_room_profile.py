"""验证规则响应来自真实读取，且只在当前回放房间和认证范围内复用。"""

import json
import unittest
from mitmproxy import http
import test_addon
from test_texas_replay import ROOM, OTHER, SELF, flow


class RoomProfileTests(unittest.TestCase):
    """验证真实房间资料缓存的结构、来源及认证隔离。"""
    def setUp(self):
        """准备本用例的独立对象、来源配置与请求记录，避免状态跨用例共享。"""
        test_addon.TexasAddonTests.setUp(self)

    def profile_request(self, room=ROOM, token='Bearer real-session', origin='https://web.invalid',
                        method='GET', host='node-0.service.invalid', suffix=''):
        """构造携带指定房间、认证头和来源的资料请求。"""
        request = flow(f'https://{host}/v10/texas_holdem/room/{room}/profile{suffix}', method)
        request.request.headers['Authorization'] = token
        request.request.headers['Origin'] = origin
        self.addon.request(request)
        return request

    def record(self, body=None, status=200, **options):
        """先确认首次读取透传，再记录指定上游资料响应。"""
        request = self.profile_request(**options)
        self.assertIsNone(request.response, '首次读取必须到真实上游')
        data = body if body is not None else {'ok': True, 'result': {
            'all_time_based_rule': [{'small_blind': 10, 'big_blind': 20}], 'extra': 'preserved'}}
        request.response = http.Response.make(status, json.dumps(data).encode())
        self.addon.response(request)
        return data

    def test_成功规则读取原样复用且保留当前来源的跨域头(self):
        """验证成功规则读取原样复用且保留当前来源的跨域头。"""
        data = self.record()
        for host in ('node-0.service.invalid', 'candidate-0.node-18.service.invalid'):
            request = self.profile_request(host=host)
            self.assertIsNotNone(request.response)
            self.assertEqual(request.response.json(), data)
            self.assertEqual(request.response.headers['Access-Control-Allow-Origin'], 'https://web.invalid')

    def test_错误与不完整规则不能被补为成功(self):
        """验证错误与不完整规则不能被补为成功。"""
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
        """验证其他认证来源房间方法主机和查询必须透传。"""
        self.record()
        for options in ({'token': 'Bearer different'}, {'token': ''}, {'token': 'Bearer '},
                        {'origin': 'https://other.invalid'}, {'room': OTHER},
                        {'host': 'unconfigured.invalid'}, {'suffix': '?fresh=true'},
                        *({'method': method} for method in ('OPTIONS', 'POST', 'PUT', 'DELETE'))):
            with self.subTest(options=options):
                self.assertIsNone(self.profile_request(**options).response)

    def test_释放场景或更换房间玩家后必须重新真实读取(self):
        """每种归属或生命周期变化都清除原规则。"""
        for change in ('release', 'scenario', 'room', 'self'):
            with self.subTest(change=change):
                self.addon.texas.room_id, self.addon.texas.self_id = ROOM, SELF
                self.record()
                self.change_owner(change)
                self.assertIsNone(self.profile_request().response)
                self.addon.room_profile.release()

    def change_owner(self, change):
        """分别执行控制命令和房间或玩家变化。"""
        changes = {
            # 通过释放控制命令验证缓存清理。
            'release': lambda: self.clear_control('/texas/release', {}),
            # 通过重新配置相同场景验证缓存清理。
            'scenario': lambda: self.clear_control('/scenario', {'scenario': 'visual-stable'}),
            # 仅改变房间标识验证房间归属隔离。
            'room': lambda: setattr(self.addon.texas, 'room_id', OTHER),
            # 仅改变当前玩家验证账号归属隔离。
            'self': lambda: setattr(self.addon.texas, 'self_id', OTHER),
        }
        changes[change]()

    def clear_control(self, path, body):
        """通过认证控制入口释放，再恢复同一房间账号以验证缓存失效。"""
        command = flow('http://test-mitmproxy.invalid' + path, 'POST', json.dumps(body).encode(), 'test-token')
        self.addon.request(command)
        self.assertEqual(command.response.status_code, 200)
        self.addon.texas.room_id, self.addon.texas.self_id = ROOM, SELF
