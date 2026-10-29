"""验证代理记录不泄露认证数据，且能区分本地模拟与真实上游响应。"""
import json
import unittest
from mitmproxy import http
from mitmproxy.websocket import WebSocketData, WebSocketMessage
from connection_diagnostics import ConnectionDiagnostics, safe_text
from test_network_faults import flow


class DiagnosticTests(unittest.TestCase):
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

    def test_sources_and_domain_redaction(self):
        diagnostics = ConnectionDiagnostics()
        for source in ('upstream', 'fixture'):
            request = flow('https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/node/v1/status?token=secret')
            response = http.Response.make(503 if source == 'fixture' else 200, b'{}')
            request.response = response if source == 'fixture' else None
            diagnostics.request(request)
            request.response = response
            diagnostics.response(request)
        events = diagnostics.snapshot()['events']
        self.assertEqual([event['source'] for event in events], ['upstream', 'upstream', 'fixture', 'fixture'])
        result = json.dumps(events)
        self.assertNotIn('shafayouxi.com', result)
        self.assertNotIn('secret', result)
        self.assertIn('64.kr-seoul.api.staging.laiwan', result)

    def test_metadata_does_not_capture_addresses_or_other_response_fields(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://api.shafayouxi.org/public/v13/metadata/servers')
        diagnostics.request(request)
        request.metadata['diagnostic_candidates_before'] = ['a.shafayouxi.com', 'b.shafayouxi.com']
        request.response = http.Response.make(200, json.dumps({'token': 'secret', 'result': {
            'servers': {'a.shafayouxi.com': 'private-address'}, 'token': 'secret'}}).encode())
        diagnostics.response(request)
        event = diagnostics.events[-1]
        self.assertEqual(event['before'], ['a', 'b'])
        self.assertEqual(event['after'], ['a'])
        self.assertNotIn('secret', json.dumps(diagnostics.snapshot()))
        self.assertNotIn('private-address', json.dumps(diagnostics.snapshot()))

    def test_websocket_subscription_acknowledgement_and_close(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://a.shafayouxi.com/socket?access_token=secret')
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

    def test_limit_and_error_redaction(self):
        diagnostics = ConnectionDiagnostics()
        request = flow('https://a.shafayouxi.com/node/v1/status')
        for _ in range(5001):
            diagnostics.request(request)
        self.assertEqual(diagnostics.dropped, 1)
        self.assertEqual(len(diagnostics.events), 5000)
        self.assertEqual(safe_text('https://user:secret@node.shafayouxi.com/path?token=secret'), 'https://node/path')
        self.assertNotIn('secret', safe_text('failed https://a.shafayouxi.com/?access_token=secret Bearer secret'))


if __name__ == '__main__':
    unittest.main()
