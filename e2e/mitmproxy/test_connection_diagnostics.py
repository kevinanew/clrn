"""验证代理记录不泄露认证数据，且能区分本地模拟与真实上游响应。"""
import json
import unittest
from mitmproxy import http
from mitmproxy.websocket import WebSocketData, WebSocketMessage
from connection_diagnostics import ConnectionDiagnostics, safe_text, node_name
from test_network_faults import flow


class DiagnosticTests(unittest.TestCase):
    def test_错误中的连接地址与主机不进入公开诊断(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://api.invalid/node/v1/status')
        diagnostics.record('proxy.error', request,
                           reason='api.invalid other.invalid:9443/private-entry 192.0.2.10:8443 [2001:db8::10]:9443 2001:db8::20')
        serialized = json.dumps(diagnostics.snapshot())
        for value in ('api.invalid', 'other.invalid', '192.0.2.10', '2001:db8::10',
                      '2001:db8::20', '9443', '8443', '/private-entry'):
            self.assertNotIn(value, serialized, '错误文本也不能复述真实连接资料')
        self.assertIn(node_name('api.invalid'), serialized, '同一节点仍须能够关联')
        self.assertEqual(node_name('api.fixture.invalid'), 'laiwan_prd-d5e6a40756c6',
                         '与 TypeScript 共用此保留地址的节点标签')
        request = flow('https://api.invalid/public/v1/hall_matching/available.json?token=secret')
        diagnostics.request(request)
        self.assertEqual(diagnostics.events[-1]['path'], '/public/v1/hall_matching/available.json')
        self.assertNotIn('secret', json.dumps(diagnostics.snapshot()))

    def test_两个认证控制入口不进入业务请求响应或错误诊断(self):
        diagnostics = ConnectionDiagnostics()
        for host in ('test-mitmproxy.invalid', 'fixtures-mitmproxy.invalid'):
            request = flow(f'http://{host}/fixtures/environment', 'POST', b'{}')
            request.response = http.Response.make(200, b'{}')
            diagnostics.request(request)
            diagnostics.response(request)
            diagnostics.error(request)
        self.assertEqual(diagnostics.snapshot(), {'events': [], 'dropped': 0},
                         '控制流量不能混入真实选线和健康探测的诊断')

    def test_来源分类与主机脱敏(self):
        diagnostics = ConnectionDiagnostics()
        for source in ('upstream', 'fixture'):
            request = flow('https://node-4.service.invalid/node/v1/status?token=secret')
            response = http.Response.make(503 if source == 'fixture' else 200, b'{}')
            request.response = response if source == 'fixture' else None
            diagnostics.request(request)
            request.response = response
            diagnostics.response(request)
        events = diagnostics.snapshot()['events']
        self.assertEqual([event['source'] for event in events], ['upstream', 'upstream', 'fixture', 'fixture'])
        result = json.dumps(events)
        self.assertNotIn('node-10.service.invalid', result)
        self.assertNotIn('secret', result)
        self.assertIn(node_name('node-4.service.invalid'), result)

    def test_节点资料不保存地址或其他响应字段(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://node-0.service.invalid/public/v13/metadata/servers')
        diagnostics.request(request)
        request.metadata['diagnostic_candidates_before'] = ['node-12.service.invalid', 'node-13.service.invalid']
        request.response = http.Response.make(200, json.dumps({'token': 'secret', 'result': {
            'servers': {'node-12.service.invalid': 'private-address'}, 'token': 'secret'}}).encode())
        diagnostics.response(request)
        event = diagnostics.events[-1]
        self.assertEqual(event['before'], [node_name(value) for value in request.metadata['diagnostic_candidates_before']])
        self.assertEqual(event['after'], [node_name(next(iter(request.response.json()['result']['servers'])))])
        self.assertNotIn('secret', json.dumps(diagnostics.snapshot()))
        self.assertNotIn('private-address', json.dumps(diagnostics.snapshot()))

    def test_订阅确认与关闭仍可关联(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://node-12.service.invalid/socket?access_token=secret')
        request.websocket = WebSocketData()
        for from_client, frame in [(True, {'id': 1, 'method': 0, 'params': {'token': 'secret'}}),
                                   (True, {'id': 2, 'method': 1, 'params': {'channel': 'room'}}),
                                   (False, {'id': 2, 'result': {}})]:
            request.websocket.messages.append(WebSocketMessage(1, from_client, json.dumps(frame).encode()))
            diagnostics.websocket_message(request)
        events = list(diagnostics.events)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[-1]['event'], 'proxy.websocket-reply')
        self.assertEqual(events[-1]['outcome'], 'success')
        self.assertEqual(events[-1]['commandId'], 2)
        self.assertNotIn('secret', json.dumps(events))
        request.websocket.close_code = 1001
        request.websocket.close_reason = 'going away'
        diagnostics.websocket_end(request)
        self.assertEqual(diagnostics.events[-1]['code'], 1001)
        self.assertNotIn(request.id, diagnostics.pending_commands)

    def test_容量边界与错误脱敏(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://node-12.service.invalid/node/v1/status')
        for _ in range(5001):
            diagnostics.request(request)
        self.assertEqual(diagnostics.dropped, 1)
        self.assertEqual(len(diagnostics.events), 5000)
        self.assertEqual(safe_text('https://user:secret@node-14.service.invalid/path?token=secret'), node_name('node-14.service.invalid'))
        self.assertNotIn('secret', safe_text('failed https://node-12.service.invalid/?access_token=secret Bearer secret'))


if __name__ == '__main__':
    unittest.main()
