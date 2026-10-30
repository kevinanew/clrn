"""真实 Node Release 服务和 mitmdump 回环对照：复用、空闲关闭及拒绝连接仍失败。"""
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


class ReleaseLifecycleIntegrationTests(unittest.TestCase):
    def wait_for(self, operation, processes, budget=15):
        deadline = time.monotonic() + budget
        while True:
            if any(process.poll() is not None for process in processes):
                reason = 'listen-denied' if 'listen EPERM:' in self.log_path.read_text() else 'detail-withheld'
                self.fail(f'隔离服务提前退出；连接生命周期未验证 reason={reason}')
            try:
                value = operation()
                if value:
                    return value
            except (OSError, ValueError, http.client.HTTPException):
                pass
            self.assertLess(time.monotonic(), deadline, '未在预算内取得真实连接事件')
            time.sleep(0.05)

    def diagnostics(self, port):
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
        try:
            client.request('GET', 'http://test-mitmproxy.invalid/diagnostics',
                           headers={'X-E2E-Control-Token': 'synthetic-control'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())['events']
        finally:
            client.close()

    def test_真实复用和空闲关闭均关联两端且新建连接失败不能伪造HTTP状态(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='clrn-lifecycle-')))
        (directory / 'index.html').write_text('isolated release bytes')
        self.log_path = directory / 'process.log'
        logs = self.enterContext(self.log_path.open('w'))
        # 直接导入生产静态服务，不复制实现、不修改 Node 的连接回收配置。
        script = '''
import { appendFileSync, writeFileSync } from 'node:fs';
const { startReleaseWebServer } = await import(process.argv[1]);
const result = await startReleaseWebServer(process.argv[2], {
  record: event => appendFileSync(process.argv[2] + '/events.jsonl', JSON.stringify(event) + '\\n')
});
writeFileSync(process.argv[2] + '/ready.json', JSON.stringify({ baseUrl: result.baseUrl, serverId: result.serverId }));
'''
        node = subprocess.Popen([shutil.which('node') or 'node', '--input-type=module', '-e', script,
                                 (ROOT / 'scripts/release-web-server.mjs').as_uri(), str(directory)],
                                stdout=logs, stderr=logs)
        self.addCleanup(stop, node)
        ready = self.wait_for(lambda: json.loads((directory / 'ready.json').read_text()), [node])
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        proxy = subprocess.Popen([str(Path(sys.executable).with_name('mitmdump')),
            '--listen-host', '127.0.0.1', '--listen-port', str(port),
            '--set', f'confdir={directory / "ca"}', '--set', 'connection_strategy=lazy',
            '--set', 'flow_detail=0', '-s', str(ROOT / 'visual/cases/texas-holdem/mitmproxy/addon.py')],
            env={**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'synthetic-control', 'MITMPROXY_API_HOSTS': '[]',
                 'CLRN_RELEASE_WEB_URL': ready['baseUrl'], 'CLRN_RELEASE_SERVER_ID': ready['serverId']},
            stdout=logs, stderr=logs)
        self.addCleanup(stop, proxy)
        self.wait_for(lambda: self.diagnostics(port) or True, [node, proxy])
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        self.addCleanup(client.close)
        identifiers = []
        for _ in range(2):
            client.request('GET', ready['baseUrl'] + '?token=synthetic-secret',
                           headers={'Authorization': 'Bearer synthetic-secret', 'Cookie': 'sid=synthetic-secret'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'isolated release bytes')
            identifiers.append(response.getheader('X-Clrn-Release-Request'))
        events = self.wait_for(lambda: [event for event in self.diagnostics(port)
                              if event['event'] == 'proxy.server-disconnected'], [node, proxy], budget=10)
        history = self.diagnostics(port)
        responses = [event for event in history if event['event'] == 'proxy.response']
        self.assertEqual([event['releaseRequestId'] for event in responses], identifiers)
        self.assertTrue(all(event['upstreamMatch'] == 'matched' for event in responses))
        upstream_ids = {event['upstreamConnectionId'] for event in responses}
        self.assertEqual(len(upstream_ids), 1, '确认两次真实请求复用同一上游连接')
        self.assertEqual(events[-1]['upstreamConnectionId'], responses[-1]['upstreamConnectionId'])
        server_events = [json.loads(line) for line in (directory / 'events.jsonl').read_text().splitlines()]
        requests = [event for event in server_events if event['event'] == 'release.request']
        self.assertEqual([event['requestId'] for event in requests], identifiers)
        self.assertEqual(len({event['connectionId'] for event in requests}), 1)
        tcp_events = [event['event'] for event in server_events if event['event'].startswith('release.tcp-')]
        self.assertIn('release.tcp-close', tcp_events)
        # 代理也可能先关闭；没有 timeout 事件时不能冒充 Node 空闲计时触发。
        configuration = next(event for event in server_events if event['event'] == 'release.listen')
        self.assertEqual(configuration['keepAliveTimeoutMs'], 5000)
        self.assertEqual(configuration['keepAliveTimeoutBufferMs'], 1000)
        stop(node)
        client.request('GET', ready['baseUrl'])
        failed = client.getresponse()
        self.assertEqual(failed.status, 502, '代理可返回自身502，不能伪造上游成功')
        failed.read()
        history = self.diagnostics(port)
        failures = [event for event in history if event['event'] == 'proxy.error']
        self.assertTrue(failures)
        self.assertEqual(failures[-1]['status'], 'unavailable')
        self.assertEqual(failures[-1]['response'], 'not-received')
        self.assertEqual(failures[-1]['upstreamMatch'], 'unavailable')
        self.assertTrue(any(event['event'] == 'proxy.server-connect-error' for event in history))
        output = json.dumps([server_events, history])
        for value in ('127.0.0.1', 'synthetic-secret', 'synthetic-control', str(directory), ready['baseUrl']):
            self.assertNotIn(value, output)
