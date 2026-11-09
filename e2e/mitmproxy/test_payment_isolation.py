"""商品展示不能创建真实订单；同时验证 HTTP 和混合 WebSocket 批次。"""

import json
import unittest
from proxy_test_support import json_lines
from unittest.mock import patch

from mitmproxy import websocket
from wsproto.frame_protocol import Opcode
from test_network_faults import flow, source_environment

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from scenario_fixtures import ScenarioFixtures

HOST = 'https://node-0.service.invalid'
PATHS = ('/v1/alipay_order/order', '/v1/virtual_payment/order',
         '/v2/telegram_payment/user/current/order')
ERROR = {'ok': False, 'error': 'fixture_payment_forbidden'}


class PaymentIsolationTests(unittest.IsolatedAsyncioTestCase):
    """验证视觉与商城场景中的 HTTP 和 WebSocket 支付隔离。"""
    def setUp(self):
        """为每个用例配置隔离来源环境、控制令牌和独立代理状态。"""
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = ScenarioFixtures()

    async def test_默认透传但商城和视觉环境拒绝订单写入(self):
        """验证默认透传但商城和视觉环境拒绝订单写入。"""
        for visual, name, blocked in ((False, 'none', False), (False, 'mall', True),
                                      (True, 'none', True), (True, 'wallet-populated', True)):
            await self.check_payment_scene(visual, name, blocked)
        self.addon.name = 'mall'
        for path in ('/v1/virtual_payment/orders', '/v1/alipay_order/goods',
                     '/v3/pay_action/do', '/public/v13/metadata/servers'):
            request = flow(HOST + path, 'POST')
            await self.addon.request(request)
            self.assertIsNone(request.response, '不得以订单防写伪造建房或初始化结果')
        request = flow('https://production.invalid' + PATHS[0], 'POST')
        await self.addon.request(request)
        self.assertIsNone(request.response, '只在明确配置的 API 来源启用夹具')

    async def test_长连接订单隔离保留订阅心跳读取和回复顺序(self):
        """验证长连接订单隔离保留订阅心跳读取和回复顺序。"""
        for scene, visual in (('none', False), ('mall', False), ('none', True)):
            await self.check_socket_scene(scene, visual)

    async def test_未命中长连接内容逐字透传且不处理服务端或已注入消息(self):
        """验证未命中长连接内容逐字透传且不处理服务端或已注入消息。"""
        self.addon.visual = True
        for content, from_client, injected in (
                ('{"id":1,"method":7}\n\n', True, False),
                ('{"id":2,"method":9,"params":{"data":{"path":"/v1/alipay_order/order","method":"POST"}}}\n', False, False),
                ('{"id":3,"method":9,"params":{"data":{"path":"/v1/alipay_order/order","method":"POST"}}}\n', True, True)):
            socket = flow(HOST + '/connection/websocket')
            socket.websocket = websocket.WebSocketData()
            message = websocket.WebSocketMessage(Opcode.TEXT, from_client, content.encode(), injected=injected)
            socket.websocket.messages.append(message)
            with patch('scenario_fixtures.ctx.master', create=True) as master:
                self.addon.websocket_message(socket)
                master.commands.call.assert_not_called()
            self.assertEqual(message.content, content.encode())
            self.assertFalse(message.dropped)

    async def check_payment_scene(self, visual, name, blocked):
        """验证一个环境中的所有订单路径及请求方法。"""
        self.addon.visual, self.addon.name = visual, name
        for path in PATHS:
            for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'GET', 'HEAD', 'OPTIONS'):
                await self.check_payment_method(visual, name, blocked, path, method)

    async def check_payment_method(self, visual, name, blocked, path, method):
        """区分订单写入与只读请求，检查响应及错误状态。"""
        with self.subTest(visual=visual, name=name, path=path, method=method):
            request = flow(HOST + path, method)
            await self.addon.request(request)
            if blocked and method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                self.assertEqual(request.response.status_code, 403)
                self.assertEqual(request.response.json(), ERROR)
            else:
                self.assertIsNone(request.response)
            self.assertIsNone(request.error)

    async def check_socket_scene(self, scene, visual):
        """验证场景对混合批次的隔离、透传及注入边界。"""
        self.addon.name, self.addon.visual = scene, visual
        socket = flow(HOST + '/connection/websocket')
        socket.websocket = websocket.WebSocketData()
        subscription = {'id': 1, 'method': 1, 'params': {'channel': 'real-room'}}
        commands, read = self.payment_commands(subscription)
        content = self.command_text(commands)
        message = websocket.WebSocketMessage(Opcode.TEXT, True, content.encode())
        socket.websocket.messages.append(message)
        with patch('scenario_fixtures.ctx.master', create=True) as master:
            self.addon.websocket_message(socket)
            if scene == 'none' and not visual:
                self.assertEqual(message.text, content)
                master.commands.call.assert_not_called()
            else:
                self.assert_blocked_socket(message, master, socket, subscription, read)

    def payment_commands(self, subscription):
        """构造订阅、心跳、三种订单及只读查询的混合批次。"""
        commands = [subscription, {'method': 7}]
        for index, path in enumerate(PATHS, 2):
            commands.append({'id': index, 'method': 9, 'params': {'data': {'path': path, 'method': 'POST'}}})
        read = {'id': 10, 'method': 9, 'params': {'data': {'path': PATHS[0], 'method': 'GET'}}}
        commands.append(read)
        return commands, read

    def command_text(self, commands):
        """按原顺序编码混合命令，不添加尾部换行。"""
        return '\n'.join(json.dumps(item) for item in commands)

    def assert_blocked_socket(self, message, master, socket, subscription, read):
        """订单回复保持原顺序，订阅、心跳和只读命令仍被转发。"""
        self.assertEqual(json_lines(message.text),
                         [subscription, {'method': 7}, read])
        command, target, to_client, payload, is_text = master.commands.call.call_args.args
        self.assertEqual((command, target, to_client, is_text), ('inject.websocket', socket, True, True))
        self.assertEqual(json_lines(payload.decode()),
                         [{'id': index, 'result': {'data': ERROR}} for index in range(2, 5)])

if __name__ == '__main__':
    unittest.main()
