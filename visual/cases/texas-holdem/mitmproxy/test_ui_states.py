"""校验新视觉夹具的范围、鉴权、释放及真实支付隔离。"""

import json
import unittest
from unittest.mock import patch
from test_texas_replay import ROOM, OTHER, SELF, flow, socket_flow, message
from addon import TexasVisualProxy
from test_network_faults import source_environment


class UIStateTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.arm_created_room(ROOM, SELF)

    def request(self, path, method='GET', body=None, host='node-0.service.invalid'):
        request = flow(f'https://{host}{path}', method, json.dumps(body or {}).encode())
        self.addon.request(request)
        return request

    def control(self, body, token='test-token'):
        request = flow('http://test-mitmproxy.invalid/texas/ui', 'POST', json.dumps(body).encode(), token)
        self.addon.request(request)
        return request

    def test_界面控制必须认证并匹配房间与有效状态(self):
        for body in ([], {'rpcError': 'unknown'}, {'applications': 'unknown'}, {'other': True}):
            self.assertEqual(self.control(body).response.status_code, 400)
        self.assertEqual(self.control({'rpcError': 'auth'}, None).response.status_code, 403)
        self.assertIsNone(self.addon.ui.rpc_error)
        self.addon.texas.release()
        self.assertEqual(self.control({'rpcError': 'auth'}).response.status_code, 400)

    def test_申请行与分页仅匹配当前房间(self):
        self.control({'applications': 'more'})
        path = f'/v11/buy_in/{ROOM}/applications'
        first = json.loads(self.request(path).response.content)['result']
        self.assertEqual(len(first['applications']), 2)
        self.assertEqual(first['next_page'], 'visual-next')
        second = json.loads(self.request(path + '?next_page=visual-next').response.content)['result']
        self.assertEqual(len(second['applications']), 1)
        self.assertEqual(second['next_page'], '')
        self.assertIsNone(self.request(path + '?next_page=other').response)
        self.assertIsNone(self.request(f'/v11/buy_in/{OTHER}/applications').response)
        self.assertIsNone(self.request(path, 'POST').response)
        self.assertIsNone(self.request(path, host='node-9.service.invalid').response)
        self.control({'applications': 'resolved'})
        rows = json.loads(self.request(path).response.content)['result']['applications']
        self.assertEqual([item['status'] for item in rows], ['approve', 'reject', 'overdue'])

    def test_选择写入不能影响其他房间(self):
        for suffix in ('enable_auto_rebuy', 'disable_auto_rebuy'):
            path = f'/v10/texas_holdem/room/{ROOM}/user_settings/{suffix}'
            self.assertIsNotNone(self.request(path, 'PUT').response)
            self.assertIsNone(self.request(path, 'POST').response)
            self.assertIsNone(self.request(path.replace(ROOM, OTHER), 'PUT').response)
        for method in ('PUT', 'DELETE'):
            path = f'/v10/texas_holdem/room/{ROOM}/hand_prediction'
            self.assertIsNotNone(self.request(path, method).response)
            self.assertIsNone(self.request(path.replace(ROOM, OTHER), method).response)
        self.assertIsNone(self.request(path, 'POST').response)

    def test_支付隔离严格匹配房间方法与确切动作(self):
        frame = {'id': 9, 'method': 9, 'params': {'data': {'method': 'POST', 'path': '/v3/pay_action/do',
                 'json': {'action_url': {'room_id': ROOM, 'method': 'POST', 'path':
                 '/v10/texas_holdem/room/$room_id$/game/$game_id$/operating_time'}}}}}
        self.assertTrue(self.addon.texas.is_replay_rpc(frame))
        action = frame['params']['data']['json']['action_url']
        for key, value in [('room_id', OTHER), ('method', 'PUT'), ('path', '/other')]:
            original = action[key]
            action[key] = value
            self.assertFalse(self.addon.texas.is_replay_rpc(frame))
            action[key] = original

    def test_调用错误注入浏览器且释放后重置(self):
        self.control({'rpcError': 'auth'})
        socket = socket_flow()
        frame = {'id': 4, 'method': 9, 'params': {'data': {'method': 'POST',
                 'path': f'/v10/texas_holdem/room/{ROOM}/game/visual-fixed-game/call'}}}
        msg = message(socket, [frame])
        with patch('texas_replay.ctx.master', create=True) as master:
            self.addon.texas.websocket_message(socket)
            reply = json.loads(master.commands.call.call_args.args[3])
            self.assertEqual(reply['result']['data']['message'], 'Access Token Not Found')
            self.assertFalse(reply['result']['data']['ok'])
            self.assertTrue(msg.dropped)
        release = flow('http://test-mitmproxy.invalid/texas/release', 'POST', b'{}', 'test-token')
        self.addon.request(release)
        self.assertIsNone(self.addon.ui.rpc_error)
        self.assertIsNone(self.addon.texas.ui_states)


if __name__ == '__main__':
    unittest.main()
