"""验证代理记录不泄露认证数据，且能区分本地模拟与真实上游响应。"""
import json
import unittest
from mitmproxy import http
from mitmproxy.websocket import WebSocketData, WebSocketMessage
from connection_diagnostics import ConnectionDiagnostics, PATH_TEMPLATES, safe_path, safe_text, node_name
from test_network_faults import flow


class DiagnosticTests(unittest.TestCase):
    def test_共用路径登记保留操作语义且重复清理不改变实体模板(self):
        for path, segments in PATH_TEMPLATES:
            with self.subTest(path=path):
                self.assertEqual(safe_path(path), path)
                self.assertEqual(safe_path('/'.join('token=synthetic-secret' if part.startswith('{') else part
                                                   for part in segments)), path)
        for path in ('//api.fixture.invalid/private', 'https://api.fixture.invalid/private',
                     '/v10/wallet/user/extra', '/v10/wallet/../profile', '/v10/wallet/', '/', ['secret']):
            self.assertEqual(safe_path(path), '[未知接口]')

    def test_相对路径与事件名不保留任意连接资料或凭据(self):
        diagnostics = ConnectionDiagnostics()
        inputs = ('api.fixture.invalid', '192.0.2.10:8443', '[2001:db8::10]:9443',
                  'token=synthetic-secret', 'Bearer synthetic-secret', 'synthetic-secret',
                  '%61pi.fixture.invalid', '%31%39%32.0.2.10', '%255B2001%253Adb8%253A%253A10%255D')
        for value in inputs:
            with self.subTest(value=value):
                request = flow('https://api.invalid/node/v1/status')
                diagnostics.record(f'proxy.{value}', request, path=f'/nested/{value}/operation.json', status=503)
                self.assertEqual(diagnostics.events[-1]['event'], 'application.event')
                self.assertEqual(diagnostics.events[-1]['path'], '[未知接口]')
                request.request.path = f'/nested/{value}/operation.json'
                diagnostics.request(request)
                self.assertEqual(diagnostics.events[-1]['path'], '[未知接口]')
                diagnostics.record('proxy.request', request, path=f'/v10/wallet/{value}')
                self.assertEqual(diagnostics.events[-1]['path'], '/v10/wallet/{user}')
        for path in ('/node/v1/status', '/public/v13/metadata/servers',
                     '/public/v1/hall_matching/available.json', '/public/v11/game_log/available.json',
                     '/v3/pay_action/batch/price'):
            request = flow(f'https://api.invalid{path}?token=synthetic-secret')
            diagnostics.request(request)
            self.assertEqual(diagnostics.events[-1]['path'], path)
        serialized = json.dumps(diagnostics.snapshot())
        for value in inputs:
            self.assertNotIn(value, serialized)
        self.assertTrue(any(event.get('status') == 503 for event in diagnostics.events))

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
