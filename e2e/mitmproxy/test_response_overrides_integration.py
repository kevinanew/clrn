"""五个真实 mitmdump 入口连接本机上游，验证正常视觉模式保留动态选线。"""

import gzip
from concurrent.futures import ThreadPoolExecutor
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
from connection_diagnostics import node_name
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
METADATA_PATHS = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
SERVER_HOSTS = ('node-4.service.invalid',
                'node-7.service.invalid',
                'node-15.service.invalid')
OWNER = '33333333-3333-4333-8333-333333333333'
ROOM = '11111111-1111-4111-8111-111111111111'


class Upstream(BaseHTTPRequestHandler):
    """为响应覆盖集成测试提供可控元数据、健康检查与业务响应。"""
    def do_GET(self):
        """按路径提供节点列表、健康状态和场景上游响应。"""
        address = urlsplit(self.path)
        hostname = address.hostname or self.headers['Host']
        if address.path in METADATA_PATHS:
            # 模拟真实 v12 数组与 v13 字典，以及不再提供首尔节点的后续列表。
            candidates = SERVER_HOSTS[1:] if address.query == 'changed' else SERVER_HOSTS
            servers = (list(candidates) if address.path == METADATA_PATHS[0]
                       else {host: f'address-{index}' for index, host in enumerate(candidates)})
            body = {'ok': True, 'new_envelope': 42, 'result': {'servers': servers, 'new_field': True}}
        elif address.path == f'/v10/house/user/{OWNER}':
            body = {'ok': True, 'result': {'house_id': 'offline-house', 'user_id': OWNER}}
        elif address.path == '/v3/pay_action/do':
            body = {'ok': True, 'result': {'room_id': ROOM}}
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
        self.send_header('Access-Control-Allow-Origin', 'https://node-3.service.invalid')
        if address.query == 'compressed':
            content = gzip.compress(content)
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        """记录订单写入请求后复用本机响应路由。"""
        if urlsplit(self.path).path.endswith('/order'):
            self.server.order_writes.append(self.path)
        self.do_GET()

    def do_PUT(self):
        """使用共用响应路由处理 PUT 读取。"""
        self.do_GET()

    def do_OPTIONS(self):
        """返回带上游标识的真实跨域预检响应。"""
        self.send_response(204)
        self.send_header('X-Upstream', 'real-preflight')
        self.send_header('Access-Control-Allow-Headers', 'authorization')
        self.end_headers()

    def log_message(self, *_arguments):
        """关闭本机测试服务器的默认访问日志，避免干扰诊断断言。"""
        pass


class LiveOverrideTests(unittest.TestCase):
    """通过真实代理验证响应覆盖、透传、预检与控制认证。"""
    def test_五个代理保留全部候选节点及真实健康结果(self):
        """验证五个代理保留全部候选节点及真实健康结果。"""
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        upstream.order_writes = []
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
                    self.assertEqual(upstream.order_writes, [], '五个入口均不得把订单提交给真实上游')
        finally:
            upstream.shutdown()
            upstream.server_close()
            worker.join(timeout=5)

    def check_addon(self, upstream_port, addon):
        """启动指定代理插件并执行元数据、场景及诊断边界核验。"""
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        executable = Path(sys.executable).with_name('mitmdump')
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile() as logs:
            process = subprocess.Popen([str(executable), '--listen-host', '127.0.0.1',
                '--listen-port', str(port), '--mode', f'upstream:http://127.0.0.1:{upstream_port}',
                '--set', f'confdir={directory}', '--set', 'connection_strategy=lazy',
                '--set', 'flow_detail=0',
                '-s', str(ROOT / 'e2e/mitmproxy/scenario_fixtures.py'), '-s', str(ROOT / addon)],
                env={**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token',
                     'MITMPROXY_API_HOSTS': '["node-0.service.invalid", "node-4.service.invalid", "node-7.service.invalid", "node-8.service.invalid", "node-15.service.invalid", "candidate-0.node-18.service.invalid", "candidate-1.node-18.service.invalid", "candidate-2.node-18.service.invalid"]'}, stdout=logs, stderr=logs)
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
                self.assertEqual(self.fetch(port, 'http://fixtures-mitmproxy.invalid/fixtures/environment',
                                           'POST', {'visual': True})[0], 200)
                self.check_metadata(port)
                self.check_health(port)
                if 'texas-holdem' in addon or 'zhajinhua' in addon:
                    self.check_diagnostics(port)
                self.check_scenes(port)
                if addon == 'e2e/mitmproxy/network_faults.py':
                    self.check_club_boundaries(port)
                if 'texas-holdem' in addon:
                    self.check_game_hold(port)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def check_metadata(self, port):
        """核验各版本节点元数据的数组、字典、压缩与失败响应契约。"""
        for path in METADATA_PATHS:
            metadata = 'http://node-0.service.invalid' + path
            for method in ('GET', 'POST'):
                for query in ('', 'changed', 'compressed', 'failed', 'html'):
                    with self.subTest(path=path, method=method, query=query):
                        status, headers, body = self.fetch(port, metadata + '?' + query, method)
                        self.assertEqual(status, 503 if query == 'failed' else 200)
                        self.assertEqual(headers['etag'], 'upstream-version')
                        self.assertEqual(headers['x-upstream'], 'real')
                        self.assertEqual(headers['access-control-allow-origin'], 'https://node-3.service.invalid')
                        if query == 'html':
                            self.assertEqual(body, '<html>upstream failure</html>')
                            continue
                        candidates = SERVER_HOSTS[1:] if query == 'changed' else SERVER_HOSTS
                        servers = (list(candidates) if path == METADATA_PATHS[0]
                                   else {host: f'address-{index}' for index, host in enumerate(candidates)})
                        self.assertEqual(body, {'ok': True, 'new_envelope': 42, 'result': {
                            'servers': servers, 'new_field': True}})
            self.check_preflight(port, metadata)

    def check_scenes(self, port):
        """切换夹具场景并核验对应业务接口的拦截和透传。"""
        control = 'http://fixtures-mitmproxy.invalid/fixtures/select'
        goods = 'http://node-0.service.invalid/v1/alipay_order/goods'
        self.assertEqual(self.fetch(port, control, 'POST', {'name': 'mall'})[0], 200)
        status, headers, body = self.fetch(port, goods)
        self.assertEqual(status, 200)
        self.assertNotIn('x-upstream', headers)
        self.assertEqual(len(body['result']), 7)
        for path in ('/v1/alipay_order/order', '/v1/virtual_payment/order',
                     f'/v2/telegram_payment/user/{OWNER}/order'):
            status, headers, body = self.fetch(port, 'http://node-0.service.invalid' + path, 'POST')
            self.assertEqual(status, 403)
            self.assertNotIn('x-upstream', headers, '真实订单不能到达上游')
            self.assertEqual(body, {'ok': False, 'error': 'fixture_payment_forbidden'})
            self.check_preflight(port, 'http://node-0.service.invalid' + path)
        # 恢复默认后必须再次到达同一真实上游，不能有 Node 后备响应服务器。
        self.assertEqual(self.fetch(port, control, 'POST', {'name': 'none'})[0], 200)
        self.assertEqual(self.fetch(port, goods)[1]['x-upstream'], 'real')
        self.assertEqual(self.fetch(port, control, 'POST', {'name': 'slot'})[0], 200)
        status, headers, body = self.fetch(port, 'http://node-0.service.invalid/v2/slot_machine/user/unbound/spin', 'POST')
        self.assertEqual(status, 200)
        self.assertNotIn('x-upstream', headers)
        self.assertEqual(body, {'ok': False, 'error': 'fixture_owner_mismatch'})
        self.assertEqual(self.fetch(port, control, 'POST', {'name': 'none'})[0], 200)

    def check_health(self, port):
        """核验各候选主机的真实健康状态、负载与延迟。"""
        for host, status, load, delay in zip(SERVER_HOSTS, (200, 200, 503),
                                            ('normal', 'normal', 'offline'), (1065, 100, 9999)):
            address = f'http://{host}/node/v1/status'
            observed, headers, body = self.fetch(port, address)
            self.assertEqual(observed, status)
            self.assertEqual(headers['x-upstream'], 'real')
            self.assertEqual(body, {'backend_delay': delay, 'server_load': load, 'new_health': True})
            self.check_preflight(port, address)

    def check_club_boundaries(self, port):
        """验证俱乐部夹具仅影响限定列表，保留其他业务请求。"""
        api = 'http://node-0.service.invalid'
        control = 'http://fixtures-mitmproxy.invalid/fixtures/select'
        for name, count in (('club-empty', 0), ('club-skeleton', 2)):
            self.assertEqual(self.fetch(port, control, 'POST', {'name': name, 'userId': OWNER})[0], 200)
            _, headers, body = self.fetch(port, api + f'/v10/club?user_id={OWNER}')
            self.assertNotIn('x-upstream', headers)
            self.assertEqual(len(body['result']['clubs']), count)
            for query in ('', '?user_id=', '?user_id=another-owner',
                          f'?user_id={OWNER}&user_id=another-owner', '?failed'):
                # 上游响应头和完整失败正文都必须保留，不能只以“无本地响应”代替透传证据。
                status, headers, body = self.fetch(port, api + '/v10/club' + query)
                self.assertEqual(status, 503 if query == '?failed' else 200)
                self.assertEqual(headers['x-upstream'], 'real')
                self.assertEqual(body, {'backend_delay': 100, 'server_load': 'normal', 'new_health': True})
            self.check_preflight(port, api + f'/v10/club?user_id={OWNER}')
        self.assertEqual(self.fetch(port, control, 'POST', {'name': 'none'})[0], 200)
        self.assertEqual(self.fetch(port, api + f'/v10/club?user_id={OWNER}')[1]['x-upstream'], 'real')
        fault_control = 'http://test-mitmproxy.invalid/scenario'
        self.assertEqual(self.fetch(port, fault_control, 'POST', {'scenario': 'club-search-result'})[0], 200)
        target = api + '/v10/club/search?keyword=VisualClubSearch'
        self.assertNotIn('x-upstream', self.fetch(port, target)[1])
        for method, path in (('GET', '/v10/club/search?keyword=other'),
                             ('GET', '/v10/club/search?failed'), ('POST', '/v10/club/search?keyword=VisualClubSearch')):
            status, headers, body = self.fetch(port, api + path, method)
            self.assertEqual(status, 503 if path.endswith('?failed') else 200)
            self.assertEqual(headers['x-upstream'], 'real')
            self.assertEqual(body, {'backend_delay': 100, 'server_load': 'normal', 'new_health': True})
        self.check_preflight(port, target)
        self.check_preflight(port, api + '/v10/clubs')
        self.assertEqual(self.fetch(port, fault_control, 'POST', {'scenario': 'visual-stable'})[0], 200)

    def check_game_hold(self, port):
        """验证游戏挂起场景可由控制入口释放且不影响无关请求。"""
        control = 'http://fixtures-mitmproxy.invalid/fixtures/'
        api = 'http://node-0.service.invalid'
        self.assertEqual(self.fetch(port, control + 'select', 'POST', {'name': 'none'})[0], 200)
        self.fetch(port, api + f'/v10/house/user/{OWNER}', 'PUT')
        self.fetch(port, 'http://test-mitmproxy.invalid/texas/view', 'POST', {'mode': 'hall'})
        creation = {'user_id': OWNER, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
                    'action_json': {'game_type': 'texas_react_native'}}
        self.assertEqual(self.fetch(port, api + '/v3/pay_action/do', 'POST', creation)[2]['result']['room_id'], ROOM)
        scene = {'name': 'auto-rebuy', 'roomId': ROOM}
        self.assertEqual(self.fetch(port, control + 'select', 'POST', {**scene, 'phase': 'hold'})[0], 200)
        path = api + f'/v10/texas_holdem/room/{ROOM}/user_settings/enable_auto_rebuy'
        with ThreadPoolExecutor(max_workers=1) as workers:
            pending = workers.submit(self.fetch, port, path, 'PUT')
            try:
                deadline = time.monotonic() + 2
                while self.fetch(port, control + 'status')[2]['held'] == 0:
                    self.assertFalse(pending.done(), '专用 addon 不得提前返回自动补码响应')
                    self.assertLess(time.monotonic(), deadline, '共用暂缓夹具未收到请求')
                    time.sleep(0.02)
                self.assertFalse(pending.done())
            finally:
                self.assertEqual(self.fetch(port, control + 'select', 'POST', {**scene, 'phase': 'release'})[0], 200)
            status, headers, body = pending.result(timeout=3)
        self.assertEqual(status, 200)
        self.assertNotIn('x-upstream', headers)
        self.assertEqual(body, {'ok': True, 'result': {'auto_rebuy': True}})
        # 释放 gate 后下一次写操作同样不能透传。
        self.assertNotIn('x-upstream', self.fetch(port, path, 'PUT')[1])

    def check_preflight(self, port, address):
        """核对预检仍返回真实上游状态与响应头。"""
        status, headers, _ = self.fetch(port, address, 'OPTIONS')
        self.assertEqual(status, 204)
        self.assertEqual(headers['x-upstream'], 'real-preflight')
        self.assertEqual(headers['access-control-allow-headers'], 'authorization')

    def check_diagnostics(self, port):
        """核验诊断入口认证及事件内容的安全边界。"""
        status, _, diagnostic = self.fetch(port, 'http://test-mitmproxy.invalid/diagnostics')
        self.assertEqual(status, 200)
        self.assertEqual(self.fetch(port, 'http://test-mitmproxy.invalid/diagnostics', token='wrong')[0], 403)
        events = diagnostic['events']
        self.assertFalse(any(item['event'] == 'proxy.nodes-filtered' for item in events))
        responses = [item for item in events if item['event'] == 'proxy.response']
        self.assertTrue(responses)
        self.assertTrue(all(item['source'] == 'upstream' for item in responses))
        for host in SERVER_HOSTS:
            self.assertTrue(any(item['node'] == node_name(host)
                                and item['path'] == '/node/v1/status' for item in responses))
        self.assertNotIn('node-10.service.invalid', json.dumps(diagnostic))
        self.assertNotIn('offline-token', json.dumps(diagnostic))

    def fetch(self, port, url, method='GET', body=None, token='offline-token'):
        """通过本机代理发送带可选 JSON 正文的请求并读取完整响应。"""
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
