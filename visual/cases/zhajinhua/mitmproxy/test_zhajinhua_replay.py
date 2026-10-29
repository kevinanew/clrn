"""使用真实 mitmproxy flow 验证注入方向、隔离和混合批次。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import websocket
from wsproto.frame_protocol import Opcode
from mitmproxy import connection, http
from zhajinhua_replay import ZhajinhuaReplay, PLAYER_IDS
with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from addon import ZhajinhuaVisualProxy


def flow(url, method='GET', body=b'', token=None):
    result = http.HTTPFlow(
        connection.Client(peername=('127.0.0.1', 12345), sockname=('127.0.0.1', 8080)),
        connection.Server(address=('node-0.service.invalid', 443)), live=True)
    result.request = http.Request.make(method, url, body)
    if token:
        result.request.headers['X-E2E-Control-Token'] = token
    return result

ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
SELF = '33333333-3333-4333-8333-333333333333'
CHANNEL = f'zhajinhua>{ROOM}#{SELF}'


def socket_flow():
    result = flow('https://node-4.service.invalid/v2/centrifugo/connection/websocket')
    result.websocket = websocket.WebSocketData()
    return result


def message(result, frames, from_client=True, injected=False):
    content = '\n'.join(json.dumps(frame) for frame in frames).encode()
    msg = websocket.WebSocketMessage(Opcode.TEXT, from_client, content, injected=injected)
    result.websocket.messages.append(msg)
    return msg


class ZhajinhuaReplayTests(unittest.TestCase):
    def setUp(self):
        self.replay = ZhajinhuaReplay()
        self.socket = socket_flow()
        message(self.socket, [{'id': 1, 'method': 1, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        message(self.socket, [{'id': 1, 'result': {}}], False)
        self.replay.websocket_message(self.socket)

    def test_操作奖励必须绑定房间且释放后重置(self):
        with self.assertRaises(ValueError):
            self.replay.set_operation_reward(ROOM, True)
        with patch('zhajinhua_replay.ctx.master', create=True):
            self.replay.publish(ROOM, {})
        frame = {'params': {'data': {'path': f'/v1/zhajinhua/room/{ROOM}/game/test/call'}}}
        self.assertEqual(self.replay.rpc_result(frame), {'ok': True, 'result': {}})
        for room_id, enabled in [(OTHER, True), (ROOM, 'true')]:
            with self.assertRaises(ValueError):
                self.replay.set_operation_reward(room_id, enabled)
        self.replay.set_operation_reward(ROOM, True)
        self.assertEqual(self.replay.rpc_result(frame)['result'], {
            'add_level_experience': 25, 'level_up': {'new_level': 6}})
        foreign = {'params': {'data': {'path': f'/v1/zhajinhua/room/{OTHER}/game/test/call'}}}
        self.assertEqual(self.replay.rpc_result(foreign)['result'], {})
        self.replay.release()
        self.assertFalse(self.replay.operation_reward)
        with self.assertRaises(ValueError):
            self.replay.set_operation_reward(ROOM, True)

    def test_发布必须等待订阅成功确认(self):
        pending_socket = socket_flow()
        message(pending_socket, [{'id': 60, 'method': 1, 'params': {'channel': f'zhajinhua>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(pending_socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        message(pending_socket, [{'id': 99, 'result': {}}, {'id': 60, 'error': {'code': 103}}], False)
        self.replay.websocket_message(pending_socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        message(pending_socket, [{'id': 61, 'method': 1, 'params': {'channel': f'zhajinhua>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(pending_socket)
        message(pending_socket, [{'id': 61, 'result': {}}], False)
        self.replay.websocket_message(pending_socket)
        with patch('zhajinhua_replay.ctx.master', create=True) as master:
            self.replay.publish(OTHER, {})
            self.assertEqual(master.commands.call.call_args.args[1], pending_socket)

    def test_服务端取消订阅移除已确认频道且保留原帧(self):
        unsubscribe = {'result': {'type': 3, 'channel': CHANNEL, 'data': {'code': 2500}}}
        msg = message(self.socket, [unsubscribe], False)
        self.replay.websocket_message(self.socket)
        self.assertFalse(msg.dropped)
        self.assertEqual(json.loads(msg.content), unsubscribe)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})

    def test_客户端取消订阅和连接关闭清除待确认状态(self):
        message(self.socket, [{'id': 62, 'method': 1, 'params': {'channel': CHANNEL}},
                              {'id': 63, 'method': 2, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        message(self.socket, [{'id': 62, 'result': {}}], False)
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})
        message(self.socket, [{'id': 64, 'method': 1, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        self.replay.websocket_end(self.socket)
        self.assertNotIn(self.socket.id, self.replay.pending_subscriptions)

    def test_发布面向浏览器且必须匹配活动房间(self):
        payload = {'stream': 'zhajinhua', 'queue': [{'event': 'room_status'}]}
        with patch('zhajinhua_replay.ctx.master', create=True) as master:
            self.replay.publish(ROOM, payload)
            args = master.commands.call.call_args.args
            self.assertEqual(args[:3], ('inject.websocket', self.socket, True))
            decoded = json.loads(args[3])
            self.assertEqual(decoded['result']['channel'], CHANNEL)
            self.assertEqual(decoded['result']['data']['data'], payload)
            self.assertEqual(args[4], True)
            with self.assertRaises(ValueError):
                self.replay.publish(OTHER, payload)
            self.socket.websocket.timestamp_end = 123
            with self.assertRaises(ValueError):
                self.replay.publish(ROOM, payload)

    def test_混合批次保留心跳与无关调用且仅隔离回放房间(self):
        self.replay.room_id = ROOM
        ping = {'id': 2, 'method': 7}
        unrelated = {'id': 3, 'method': 9, 'params': {'data': {
            'path': f'/v10/zhajinhua/room/{OTHER}/game/test/call'}}}
        bet = {'id': 4, 'method': 9, 'params': {'data': {
            'path': f'/v10/zhajinhua/room/{ROOM}/game/test/call'}}}
        msg = message(self.socket, [ping, bet, unrelated])
        with patch('zhajinhua_replay.ctx.master', create=True) as master:
            self.replay.websocket_message(self.socket)
            self.assertEqual([json.loads(line) for line in msg.text.splitlines()], [ping, unrelated])
            args = master.commands.call.call_args.args
            self.assertTrue(args[2])
            self.assertEqual(json.loads(args[3])['id'], 4)
            other_socket = socket_flow()
            untouched = message(other_socket, [bet])
            self.replay.websocket_message(other_socket)
            self.assertTrue(untouched.dropped)
            self.assertEqual(master.commands.call.call_count, 2)

    def test_推送过滤保留远程调用与已注入消息(self):
        self.replay.room_id = ROOM
        publication = {'result': {'channel': CHANNEL}}
        reply = {'id': 10, 'result': {'data': {}}}
        msg = message(self.socket, [publication, reply], False)
        self.replay.websocket_message(self.socket)
        self.assertEqual(json.loads(msg.content), reply)
        injected = message(self.socket, [publication], False, True)
        self.replay.websocket_message(self.socket)
        self.assertFalse(injected.dropped)

    def test_资料按归属匹配且释放后清除夹具(self):
        self.replay.room_id = ROOM
        self.replay.self_id = SELF
        self.assertIsNone(self.replay.http_fixture(f'/v10/profile/{OTHER}'))
        profiles = self.replay.http_fixture('/v10/profile/users', json.dumps({'users': PLAYER_IDS}).encode())
        self.assertEqual(profiles[PLAYER_IDS[0]]['nickname'], 'Player1')
        self.replay.release()
        self.assertIsNone(self.replay.http_fixture(f'/v10/profile/{PLAYER_IDS[0]}'))
        self.assertIsNone(self.replay.self_id)

    def test_推送过滤保留其他数据流取消订阅与损坏结果(self):
        self.replay.room_id = ROOM
        unrelated = {'result': {'channel': f'chat>{ROOM}#{SELF}', 'type': 0}}
        unsubscribe = {'result': {'channel': CHANNEL, 'type': 3}}
        malformed = {'result': []}
        msg = message(self.socket, [unrelated, unsubscribe, malformed], False)
        self.replay.websocket_message(self.socket)
        self.assertEqual([json.loads(line) for line in msg.text.splitlines()],
                         [unrelated, unsubscribe, malformed])

    def test_取消订阅与已关闭连接不能收到回放(self):
        message(self.socket, [{'id': 2, 'method': 2, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})
        self.replay.websocket_end(self.socket)
        self.assertNotIn(self.socket.id, self.replay.subscriptions)

    def test_连接池仅在激活后隔离所属房间且释放后恢复流量(self):
        unregistered = socket_flow()
        seat = {'id': 40, 'method': 9, 'params': {'data': {
            'method': 'PUT', 'path': f'/v10/zhajinhua/room/{ROOM}/enter_and_sit'}}}
        other_room = {'id': 41, 'method': 9, 'params': {'data': {
            'method': 'PUT', 'path': f'/v10/zhajinhua/room/{OTHER}/enter_and_sit'}}}
        with patch('zhajinhua_replay.ctx.master', create=True) as master:
            before = message(unregistered, [seat, other_room])
            self.replay.websocket_message(unregistered)
            self.assertEqual([json.loads(line) for line in before.text.splitlines()], [seat, other_room])
            master.commands.call.assert_not_called()
            self.replay.publish(ROOM, {})
            master.reset_mock()
            active = message(unregistered, [seat, other_room])
            self.replay.websocket_message(unregistered)
            self.assertEqual(json.loads(active.content), other_room)
            self.assertEqual(json.loads(master.commands.call.call_args.args[3])['id'], 40)
            self.assertEqual(self.replay.blocked_rpcs, 1)
            self.replay.release()
            restored = message(unregistered, [seat])
            self.replay.websocket_message(unregistered)
            self.assertFalse(restored.dropped)
            self.assertEqual(master.commands.call.call_count, 1)

    def test_活动回放不能被其他已订阅房间替换(self):
        with patch('zhajinhua_replay.ctx.master', create=True):
            self.replay.publish(ROOM, {})
        message(self.socket, [{'id': 50, 'method': 1, 'params': {
            'channel': f'zhajinhua>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        self.assertEqual(self.replay.room_id, ROOM)

    def test_实时通信响应保留聊天室字段且不匹配其他房间(self):
        with patch('zhajinhua_replay.ctx.master', create=True):
            self.replay.publish(ROOM, {})
        for action in ('join', 'quit'):
            frame = {'method': 9, 'params': {'data': {'path': f'/v1/chat_room/{ROOM}/{action}'}}}
            self.assertTrue(self.replay.is_replay_rpc(frame))
            result = self.replay.rpc_result(frame)['result']
            self.assertEqual(result['users'], [SELF])
            self.assertEqual(result['has_joined'], action == 'join')
        frame['params']['data']['path'] = f'/v1/chat_room/{OTHER}/join'
        self.assertFalse(self.replay.is_replay_rpc(frame))

    def test_切换场景释放回放且控制必须认证(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            addon = ZhajinhuaVisualProxy()
        addon.scenario = 'visual-stable'
        addon.replay.room_id = ROOM
        unauthorized = flow('http://test-mitmproxy.invalid/zhajinhua/release', 'POST', b'{}')
        addon.control(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertEqual(addon.replay.room_id, ROOM)
        clear = flow('http://test-mitmproxy.invalid/scenario', 'POST', b'{"scenario":null}', 'test-token')
        addon.control(clear)
        self.assertEqual(clear.response.status_code, 200)
        self.assertIsNone(addon.replay.room_id)


if __name__ == '__main__':
    unittest.main()
