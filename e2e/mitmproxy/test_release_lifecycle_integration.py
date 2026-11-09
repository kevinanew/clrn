"""真实 Node Release 服务和 mitmdump 回环对照：响应关闭、完整读取及真实失败。"""
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
from proxy_test_support import events_named, field_values

ROOT = Path(__file__).resolve().parents[2]


def stop(process):
    """先终止被测进程，超时后强制结束并回收进程。"""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


class ReleaseLifecycleIntegrationTests(unittest.TestCase):
    """通过真实发布服务与代理验证连接及文件流关闭生命周期。"""
    def wait_for(self, operation, processes, budget=15):
        """在预算内轮询操作，并提前报告依赖进程退出。"""
        deadline = time.monotonic() + budget
        while True:
            self.check_processes(processes)
            ready, value = self.attempt(operation)
            if ready:
                return value
            self.assertLess(time.monotonic(), deadline, '未在预算内取得真实连接事件')
            time.sleep(0.05)

    def diagnostics(self, port):
        """通过认证控制入口读取本机代理诊断并关闭客户端连接。"""
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
        try:
            client.request('GET', 'http://test-mitmproxy.invalid/diagnostics',
                           headers={'X-E2E-Control-Token': 'synthetic-control'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())['events']
        finally:
            client.close()

    def server_events(self, directory):
        """读取本轮发布服务写出的逐行 JSON 事件日志。"""
        return [json.loads(line) for line in (directory / 'events.jsonl').read_text().splitlines()]

    def test_响应后关闭上游不复用旧连接且新建连接失败不能伪造HTTP状态(self):
        """验证响应后关闭上游不复用旧连接且新建连接失败不能伪造HTTP状态。"""
        directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='clrn-lifecycle-')))
        contents = b'A' * (4 * 1024 * 1024)
        (directory / 'index.html').write_bytes(contents)
        (directory / 'broken.js').write_text('file exists during stat')
        self.log_path = directory / 'process.log'
        logs = self.enterContext(self.log_path.open('w'))
        # 直接导入生产静态服务，不复制实现、不修改 Node 的超时配置。
        script = '''
import { appendFileSync, createReadStream, writeFileSync } from 'node:fs';
const { startReleaseWebServer } = await import(process.argv[1]);
const result = await startReleaseWebServer(process.argv[2], {
  record: event => appendFileSync(process.argv[2] + '/events.jsonl', JSON.stringify(event) + '\\n'),
  // 核验真实文件打开失败，不替换生产的传输和错误处理实现。
  openStream: filename => createReadStream(filename.endsWith('/broken.js')
    ? process.argv[2] + '/absent-file.invalid' : filename)
});
writeFileSync(process.argv[2] + '/ready.json', JSON.stringify({ baseUrl: result.baseUrl, serverId: result.serverId }));
'''
        node = subprocess.Popen([shutil.which('node') or 'node', '--input-type=module', '-e', script,
                                 (ROOT / 'scripts/release-web-server.mjs').as_uri(), str(directory)],
                                stdout=logs, stderr=logs)
        self.addCleanup(stop, node)
        # 读取服务就绪文件，等待本轮发布服务报告监听信息。
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
        # 探测代理诊断入口，等待代理开始接受控制请求。
        self.wait_for(lambda: self.diagnostics(port) or True, [node, proxy])
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        self.addCleanup(client.close)
        identifiers = self.read_twice(client, ready, contents)
        # 不等待代理的断开事件再发下一次请求，覆盖关闭通知尚未处理的边界。
        self.check_proxy_connections(port, node, proxy, identifiers)
        # 等待发布服务记录两次 TCP 连接关闭。
        self.check_release_connections(directory, node, proxy, identifiers)
        self.check_read_failure(client, ready, port)
        # 等待三个文件流关闭并确认发生过响应中断。
        server_events = self.check_stream_cleanup(directory, port, node, proxy)
        self.check_connect_failure(node, client, ready, port, server_events, directory)

    def check_connect_failure(self, node, client, ready, port, server_events, directory):
        """关闭发布服务后验证真实连接失败、无响应状态和日志脱敏。"""
        stop(node)
        client.request('GET', ready['baseUrl'])
        failed = client.getresponse()
        self.assertEqual(failed.status, 502, '代理可返回自身502，不能伪造上游成功')
        failed.read()
        history = self.diagnostics(port)
        failures = events_named(history, 'proxy.error')
        self.assertTrue(failures)
        self.assertEqual(failures[-1]['status'], 'unavailable')
        self.assertEqual(failures[-1]['response'], 'not-received')
        self.assertEqual(failures[-1]['upstreamMatch'], 'unavailable')
        self.assertTrue(bool(events_named(history, 'proxy.server-connect-error')))
        output = json.dumps([server_events, history])
        for value in ('127.0.0.1', 'synthetic-secret', 'synthetic-control', str(directory), ready['baseUrl']):
            self.assertNotIn(value, output)

    def check_stream_cleanup(self, directory, port, node, proxy):
        """等待真实文件流关闭，核验中断和失败流的清理事件。"""
        # 轮询发布服务事件，直到所有文件流关闭。
        self.wait_for(lambda: self.streams_closed(directory), [node, proxy])
        server_events = self.server_events(directory)
        broken_id = next(iter(events_named(server_events, 'release.stream-error')))['requestId']
        broken_events = self.request_events(server_events, broken_id)
        self.assertIn('release.stream-close', broken_events)
        self.assertIn('release.interrupted', broken_events)
        self.assertNotIn('release.finish', broken_events)
        return server_events

    def check_read_failure(self, client, ready, port):
        """真实文件打开失败必须记录为未收到上游 HTTP 响应。"""
        client.request('GET', ready['baseUrl'] + 'broken.js')
        broken = client.getresponse()
        self.assertEqual(broken.status, 502, '真实文件打开失败不能成为上游成功')
        broken.read()
        history = self.diagnostics(port)
        read_failure = next(event for event in reversed(history) if event['event'] == 'proxy.error')
        self.assertEqual(read_failure['status'], 'unavailable')
        self.assertEqual(read_failure['response'], 'not-received')
        self.assertEqual(read_failure['upstreamMatch'], 'matched')

    def check_release_connections(self, directory, node, proxy, identifiers):
        """核验发布服务逐请求连接关闭及未修改的空闲超时配置。"""
        # 轮询发布服务事件，直到两次 TCP 连接均已关闭。
        self.wait_for(lambda: sum(event['event'] == 'release.tcp-close'
                                 for event in self.server_events(directory)) == 2, [node, proxy])
        server_events = self.server_events(directory)
        requests = events_named(server_events, 'release.request')
        self.assertEqual(field_values(requests, 'requestId'), identifiers)
        self.assertEqual(len(set(field_values(requests, 'connectionId'))), 2)
        tcp_events = [event['event'] for event in server_events if event['event'].startswith('release.tcp-')]
        self.assertIn('release.tcp-close', tcp_events)
        self.assertEqual(tcp_events.count('release.tcp-close'), 2)
        self.assertNotIn('release.tcp-timeout', tcp_events, '响应完成主动关闭，不等待空闲超时')
        configuration = next(iter(events_named(server_events, 'release.listen')))
        self.assertEqual(configuration['keepAliveTimeoutMs'], 5000)
        self.assertEqual(configuration['keepAliveTimeoutBufferMs'], 1000)

    def check_proxy_connections(self, port, node, proxy, identifiers):
        """两次完整读取必须使用不同上游连接并记录对应断开事件。"""
        history = self.diagnostics(port)
        responses = events_named(history, 'proxy.response')
        self.assertEqual(field_values(responses, 'releaseRequestId'), identifiers)
        self.assertTrue(all(event['upstreamMatch'] == 'matched' for event in responses))
        upstream_ids = set(field_values(responses, 'upstreamConnectionId'))
        self.assertEqual(len(upstream_ids), 2, '每次响应后关闭，不能再复用等待 FIN 的旧连接')
        # 等待两次真实上游断连事件出现。
        self.wait_for(lambda: len(events_named(self.diagnostics(port), 'proxy.server-disconnected')) == 2, [node, proxy])
        events = events_named(self.diagnostics(port), 'proxy.server-disconnected')
        self.assertEqual(set(field_values(events, 'upstreamConnectionId')), upstream_ids)

    def read_twice(self, client, ready, contents):
        """连续读取两次大文件，覆盖断开通知尚未处理的边界。"""
        identifiers = []
        for _ in range(2):
            client.request('GET', ready['baseUrl'] + '?token=synthetic-secret',
                           headers={'Authorization': 'Bearer synthetic-secret', 'Cookie': 'sid=synthetic-secret'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), contents)
            identifiers.append(response.getheader('X-Clrn-Release-Request'))
        return identifiers

    def check_processes(self, processes):
        """依赖进程提前退出时立即失败，不继续消耗轮询预算。"""
        if any(process.poll() is not None for process in processes):
            self.fail(f'隔离服务提前退出；连接生命周期未验证 reason={self.process_failure_reason()}')

    def process_failure_reason(self):
        """只公开已知监听错误分类，不泄露日志正文。"""
        return 'listen-denied' if 'listen EPERM:' in self.log_path.read_text() else 'detail-withheld'

    def attempt(self, operation):
        """只重试原有可恢复读取异常，其他错误照常传播。"""
        try:
            value = operation()
            return bool(value), value
        except (OSError, ValueError, http.client.HTTPException):
            return False, None

    def streams_closed(self, directory):
        """全部三个文件流关闭且已观察中断才认为清理完成。"""
        closed = len(events_named(self.server_events(directory), 'release.stream-close')) == 3
        interrupted = bool(events_named(self.server_events(directory), 'release.interrupted'))
        return closed and interrupted

    def request_events(self, events, identifier):
        """保留某次文件读取的全部事件顺序。"""
        return [event['event'] for event in events if event.get('requestId') == identifier]
