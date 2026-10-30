"""真实浏览器经生产代理读取当前房间空榜，验证预检独立性与透传边界。"""

import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
SETTLEMENT = f'/v1/game_log/room/{ROOM}/settlement'

BROWSER = r"""
const { chromium } = await import('@playwright/test');
const configuration = JSON.parse(process.argv[1]);
const browser = await chromium.launch({
  proxy: { server: configuration.proxy, bypass: '<-loopback>' },
  ...(process.env.DIAGNOSTIC_CHROME_PATH ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(configuration.origin);
  const observed = await page.evaluate(async configuration => {
    try {
      const response = await fetch(configuration.target, {
        method: configuration.method || 'GET', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'APP-ID': 'offline', 'APP-VERSION': '1', 'Accept-Language': 'en',
          Authorization: 'Bearer offline-token', ...configuration.extraHeaders },
        signal: AbortSignal.timeout(1500),
      });
      return { outcome: 'response', status: response.status, body: await response.json() };
    } catch (error) { return { outcome: error.name }; }
  }, configuration);
  await context.close();
  console.log(JSON.stringify(observed));
} finally { await browser.close(); }
"""


class Upstream(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.server.requests.append(('OPTIONS', urlsplit(self.path).path))
        if self.server.block_preflight:
            self.server.release_preflight.wait(4)
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers', ''))
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        self.server.requests.append(('GET', path))
        self.send_response(200 if path == '/' else 503)
        self.send_header('Content-Type', 'text/html' if path == '/' else 'application/json')
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Credentials', 'true')
        content = '<!doctype html><title>本机预检对照</title>'.encode() if path == '/' else b'{"ok":false}'
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        path = urlsplit(self.path).path
        self.server.requests.append(('POST', path))
        content = json.dumps({'ok': True, 'result': {'room_id': ROOM}}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_arguments):
        pass


class SettlementPreflightTests(unittest.TestCase):
    def setUp(self):
        self.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.upstream.requests = []
        self.upstream.block_preflight = True
        self.upstream.release_preflight = threading.Event()
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.stop_upstream)
        self.origin = f'http://127.0.0.1:{self.upstream.server_port}'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        directory = self.enterContext(tempfile.TemporaryDirectory())
        logs = self.enterContext(tempfile.TemporaryFile())
        self.proxy = subprocess.Popen([
            str(Path(sys.executable).with_name('mitmdump')), '--listen-host', '127.0.0.1',
            '--listen-port', str(self.port), '--mode', f'upstream:{self.origin}',
            '--set', f'confdir={directory}', '--set', 'connection_strategy=lazy', '--set', 'flow_detail=0',
            '-s', str(ROOT / 'visual/cases/zhajinhua/mitmproxy/addon.py'),
        ], env={**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token',
                'MITMPROXY_API_HOSTS': '["node-0.service.invalid"]', 'CLRN_RELEASE_WEB_URL': self.origin},
            stdout=logs, stderr=logs)
        self.addCleanup(self.stop_proxy)
        deadline = time.monotonic() + 15
        while True:
            try:
                self.control('/status')
                break
            except OSError:
                if self.proxy.poll() is not None or time.monotonic() >= deadline:
                    self.fail('本机生产代理启动失败')
                time.sleep(0.1)
        self.control('/scenario', {'scenario': 'visual-stable'})
        # 必须先观察成功的建房响应；直接赋值不能验证生产绑定链路。
        self.request('http://node-0.service.invalid/v3/pay_action/do', 'POST', {
            'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': 'zhajinhua'},
        })

    def stop_upstream(self):
        self.upstream.release_preflight.set()
        self.upstream.shutdown()
        self.upstream.server_close()

    def stop_proxy(self):
        self.proxy.terminate()
        try:
            self.proxy.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proxy.kill()
            self.proxy.wait(timeout=5)

    def request(self, address, method='GET', body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, address, None if body is None else json.dumps(body),
                               {'X-E2E-Control-Token': 'offline-token'})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def control(self, path, body=None):
        return self.request('http://test-mitmproxy.invalid' + path, 'GET' if body is None else 'POST', body)

    def browse(self, path=SETTLEMENT, **options):
        configuration = {'proxy': f'http://127.0.0.1:{self.port}', 'origin': self.origin,
                         'target': 'http://node-0.service.invalid' + path, **options}
        completed = subprocess.run(['node', '--input-type=module', '-e', BROWSER, json.dumps(configuration)],
                                   cwd=ROOT / 'e2e', capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, '真实浏览器对照必须正常结束')
        return json.loads(completed.stdout)

    def test_上游预检无响应时当前房间仍通过本地预检读取空榜(self):
        observed = self.browse()
        self.assertEqual(observed, {'outcome': 'response', 'status': 200,
                                   'body': {'ok': True, 'result': {'settlements': []}}})
        self.assertNotIn(('OPTIONS', SETTLEMENT), self.upstream.requests, '必要夹具预检不能依赖上游')
        self.assertNotIn(('GET', SETTLEMENT), self.upstream.requests, '读取必须命中当前房间夹具')
        _, diagnostic = self.control('/diagnostics')
        responses = [event for event in diagnostic['events'] if event['event'] == 'proxy.response'
                     and event.get('method') in ('GET', 'OPTIONS') and event.get('source') == 'fixture']
        self.assertEqual({event['method'] for event in responses}, {'GET', 'OPTIONS'})

    def test_不匹配预检仍依赖上游且真实业务失败保持失败(self):
        other = f'/v1/game_log/room/{OTHER}/settlement'
        for path, options in ((other, {}), (SETTLEMENT, {'extraHeaders': {'X-Unknown': 'offline'}}),
                              (SETTLEMENT, {'method': 'POST'})):
            with self.subTest(path=path, options=options):
                self.assertNotEqual(self.browse(path, **options)['outcome'], 'response')
                self.assertIn(('OPTIONS', path), self.upstream.requests)
        self.upstream.block_preflight = False
        self.upstream.release_preflight.set()
        observed = self.browse(other)
        self.assertEqual(observed, {'outcome': 'response', 'status': 503, 'body': {'ok': False}},
                         '预检成功不能把其他房间的真实业务错误伪造成成功')


if __name__ == '__main__':
    unittest.main()
