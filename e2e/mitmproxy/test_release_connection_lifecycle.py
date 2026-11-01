"""使用锁定 mitmproxy 的真实事件类型验证安全连接记录；不连接任何业务接口。"""
import json
import unittest
from unittest.mock import patch
from mitmproxy import http
from mitmproxy.proxy.server_hooks import ServerConnectionHookData
from connection_diagnostics import ConnectionDiagnostics
from test_network_faults import flow


class ReleaseConnectionTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': 'http://127.0.0.1:18080/'}))
        self.diagnostics = ConnectionDiagnostics()
        self.request = flow('http://127.0.0.1:18080/asset.webp?token=synthetic-secret')
        self.request.server_conn.address = ('127.0.0.1', 18080)
        self.request.server_conn.error = 'https://connection.invalid/private Cookie: synthetic-secret'
        self.data = ServerConnectionHookData(server=self.request.server_conn, client=self.request.client_conn)

    def test_真实钩子类型记录连接及断开且同一连接的多请求可以关联(self):
        self.diagnostics.server_connect(self.data)
        self.assertEqual(self.diagnostics.events[-1]['upstreamMatch'], 'unavailable')
        self.data.server.peername = ('127.0.0.1', 18080)
        self.data.server.timestamp_tcp_setup = 1
        self.diagnostics.server_connected(self.data)
        for identifier in ('request-first', 'request-reused'):
            self.request.id = identifier
            self.request.response = None
            self.diagnostics.request(self.request)
            self.request.response = http.Response.make(200, b'synthetic-secret')
            self.diagnostics.response(self.request)
        self.diagnostics.server_disconnected(self.data)
        events = self.diagnostics.snapshot()['events']
        self.assertEqual([event['event'] for event in events], [
            'proxy.server-connect', 'proxy.server-connected', 'proxy.request', 'proxy.response',
            'proxy.request', 'proxy.response', 'proxy.server-disconnected'])
        self.assertEqual({event['upstreamConnectionId'] for event in events}, {str(self.data.server.id)})
        self.assertEqual(events[-1]['upstreamMatch'], 'matched')
        for event in events:
            if event['operation'] == 'release-static-connect':
                self.assertNotIn('status', event, 'TCP 事件不能冒充 HTTP 响应')
                self.assertNotIn('method', event)
        output = json.dumps(events)
        for value in ('127.0.0.1', '18080', 'connection.invalid', '/private', 'synthetic-secret'):
            self.assertNotIn(value, output)

    def test_未连接及连接到不同peer不猜测响应或实际来源(self):
        self.diagnostics.server_connect_error(self.data)
        self.assertEqual(self.diagnostics.events[-1]['upstreamMatch'], 'unavailable')
        for peer in [('192.0.2.40', 18080), ('127.0.0.1', 18081)]:
            self.data.server.peername = peer
            self.data.server.timestamp_tcp_setup = 1
            self.diagnostics.server_connected(self.data)
            self.assertEqual(self.diagnostics.events[-1]['upstreamMatch'], 'different')
        self.assertTrue(all('status' not in event for event in self.diagnostics.events))
        self.assertNotIn('synthetic-secret', json.dumps(self.diagnostics.snapshot()))

    def test_其他目标和无效配置不收集也不改变真实连接(self):
        original_error = self.data.server.error
        for target in [('other.invalid', 18080), ('127.0.0.1', 18081)]:
            self.data.server.address = target
            self.diagnostics.server_connect(self.data)
        self.data.server.address = ('127.0.0.1', 18080)
        for configured in ['', 'https://127.0.0.1:18080/', 'http://synthetic:secret@127.0.0.1:18080/',
                           'http://127.0.0.1:invalid/']:
            with patch.dict('os.environ', {'CLRN_RELEASE_WEB_URL': configured}):
                self.diagnostics.server_connected(self.data)
        self.assertEqual(list(self.diagnostics.events), [])
        self.assertEqual(self.data.server.error, original_error)
        self.assertIsNone(self.data.server.timestamp_tcp_setup)

    def test_连接事件共用有界时间线且超限可见(self):
        for _ in range(5001):
            self.diagnostics.server_connect(self.data)
        self.assertEqual(len(self.diagnostics.events), 5000)
        self.assertEqual(self.diagnostics.dropped, 1)
