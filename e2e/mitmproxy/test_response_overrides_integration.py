"""五个真实 mitmdump 入口连接本机上游，验证正常视觉模式保留动态选线。"""

import gzip
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
METADATA_PATHS = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
SERVER_HOSTS = ('64.kr-seoul.api.staging.laiwan.shafayouxi.com',
                '67.hk-sn.api.staging.laiwan.shafayouxi.com',
                '69.us-la.api.staging.laiwan.shafayouxi.com')


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        address = urlsplit(self.path)
        hostname = address.hostname or self.headers['Host']
        if address.path in METADATA_PATHS:
            # 模拟真实 v12 数组与 v13 字典，以及不再提供首尔节点的后续列表。
            candidates = SERVER_HOSTS[1:] if address.query == 'changed' else SERVER_HOSTS
            servers = (list(candidates) if address.path == METADATA_PATHS[0]
                       else {host: f'address-{index}' for index, host in enumerate(candidates)})
            body = {'ok': True, 'new_envelope': 42, 'result': {'servers': servers, 'new_field': True}}
        else:
            # 首尔指标越界不影响香港的真实健康响应；洛杉矶的真实失败也不能被改成成功。
            offline = hostname == SERVER_HOSTS[2]
            body = {'backend_delay': 9999 if offline else 1065 if hostname == SERVER_HOSTS[0] else 100,
                    'server_load': 'offline' if offline else 'normal', 'new_health': True}
        status = 503 if address.query == 'failed' or hostname == SERVER_HOSTS[2] else 200
        content = b'<html>upstream failure</html>' if address.query == 'html' else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/html' if address.query == 'html' else 'application/json')
        self.send_header('X-Upstream', 'real')
        self.send_header('ETag', 'upstream-version')
        self.send_header('Access-Control-Allow-Origin', 'https://app.test')
        if address.query == 'compressed':
            content = gzip.compress(content)
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('X-Upstream', 'real-preflight')
        self.send_header('Access-Control-Allow-Headers', 'authorization')
        self.end_headers()

    def log_message(self, *_arguments):
        pass


class LiveOverrideTests(unittest.TestCase):
    def test_五个代理保留全部候选节点及真实健康结果(self):
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        worker = threading.Thread(target=upstream.serve_forever, daemon=True)
        worker.start()
        try:
            for addon in ('e2e/mitmproxy/network_faults.py',
                          'visual/cases/texas-holdem/mitmproxy/addon.py',
                          'visual/cases/zhajinhua/mitmproxy/addon.py',
                          'visual/cases/game-record/mitmproxy/addon.py',
                          'visual/cases/club/mitmproxy/addon.py'):
                with self.subTest(addon=addon):
                    self.check_addon(upstream.server_port, addon)
        finally:
            upstream.shutdown()
            upstream.server_close()
            worker.join(timeout=5)

    def check_addon(self, upstream_port, addon):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        executable = Path(sys.executable).with_name('mitmdump')
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile() as logs:
            process = subprocess.Popen([str(executable), '--listen-host', '127.0.0.1',
                '--listen-port', str(port), '--mode', f'upstream:http://127.0.0.1:{upstream_port}',
                '--set', f'confdir={directory}', '--set', 'connection_strategy=lazy',
                '--set', 'flow_detail=0', '-s', str(ROOT / addon)],
                env={**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token'}, stdout=logs, stderr=logs)
            try:
                deadline = time.monotonic() + 15
                while True:
                    try:
                        status, _, _ = self.fetch(port, 'http://test-mitmproxy.invalid/status')
                        self.assertEqual(status, 200)
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            logs.seek(0)
                            self.fail('mitmdump 启动失败：' + logs.read().decode()[-2000:])
                        time.sleep(0.1)
                self.fetch(port, 'http://test-mitmproxy.invalid/scenario', 'POST', {'scenario': 'visual-stable'})
                self.check_metadata(port)
                self.check_health(port)
                if 'texas-holdem' in addon or 'zhajinhua' in addon:
                    self.check_diagnostics(port)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def check_metadata(self, port):
        for path in METADATA_PATHS:
            metadata = 'http://api.shafayouxi.org' + path
            for method in ('GET', 'POST'):
                for query in ('', 'changed', 'compressed', 'failed', 'html'):
                    with self.subTest(path=path, method=method, query=query):
                        status, headers, body = self.fetch(port, metadata + '?' + query, method)
                        self.assertEqual(status, 503 if query == 'failed' else 200)
                        self.assertEqual(headers['etag'], 'upstream-version')
                        self.assertEqual(headers['x-upstream'], 'real')
                        self.assertEqual(headers['access-control-allow-origin'], 'https://app.test')
                        if query == 'html':
                            self.assertEqual(body, '<html>upstream failure</html>')
                            continue
                        candidates = SERVER_HOSTS[1:] if query == 'changed' else SERVER_HOSTS
                        servers = (list(candidates) if path == METADATA_PATHS[0]
                                   else {host: f'address-{index}' for index, host in enumerate(candidates)})
                        self.assertEqual(body, {'ok': True, 'new_envelope': 42, 'result': {
                            'servers': servers, 'new_field': True}})
            self.check_preflight(port, metadata)

    def check_health(self, port):
        for host, status, load, delay in zip(SERVER_HOSTS, (200, 200, 503),
                                            ('normal', 'normal', 'offline'), (1065, 100, 9999)):
            address = f'http://{host}/node/v1/status'
            observed, headers, body = self.fetch(port, address)
            self.assertEqual(observed, status)
            self.assertEqual(headers['x-upstream'], 'real')
            self.assertEqual(body, {'backend_delay': delay, 'server_load': load, 'new_health': True})
            self.check_preflight(port, address)

    def check_preflight(self, port, address):
        status, headers, _ = self.fetch(port, address, 'OPTIONS')
        self.assertEqual(status, 204)
        self.assertEqual(headers['x-upstream'], 'real-preflight')
        self.assertEqual(headers['access-control-allow-headers'], 'authorization')

    def check_diagnostics(self, port):
        status, _, diagnostic = self.fetch(port, 'http://test-mitmproxy.invalid/diagnostics')
        self.assertEqual(status, 200)
        self.assertEqual(self.fetch(port, 'http://test-mitmproxy.invalid/diagnostics', token='wrong')[0], 403)
        events = diagnostic['events']
        self.assertFalse(any(item['event'] == 'proxy.nodes-filtered' for item in events))
        responses = [item for item in events if item['event'] == 'proxy.response']
        self.assertTrue(responses)
        self.assertTrue(all(item['source'] == 'upstream' for item in responses))
        for host in SERVER_HOSTS:
            self.assertTrue(any(item['node'] == host.replace('.shafayouxi.com', '')
                                and item['path'] == '/node/v1/status' for item in responses))
        self.assertNotIn('shafayouxi.com', json.dumps(diagnostic))
        self.assertNotIn('offline-token', json.dumps(diagnostic))

    def fetch(self, port, url, method='GET', body=None, token='offline-token'):
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            client.request(method, url, None if body is None else json.dumps(body),
                           {'X-E2E-Control-Token': token, 'Content-Type': 'application/json'})
            response = client.getresponse()
            content = response.read()
            headers = {key.lower(): value for key, value in response.getheaders()}
            if headers.get('content-encoding') == 'gzip':
                content = gzip.decompress(content)
            body = (json.loads(content) if headers.get('content-type', '').startswith('application/json')
                    else content.decode()) if content else None
            return response.status, headers, body
        finally:
            client.close()


if __name__ == '__main__':
    unittest.main()
