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
from proxy_test_support import events_named, field_values
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
SETTLEMENT = f'/v1/game_log/room/{ROOM}/settlement'

BROWSER = r"""
let stage = 'module-import';
let browser;
try {
  const { chromium } = await import('@playwright/test');
  const configuration = JSON.parse(process.argv[1]);
  stage = 'browser-launch';
  browser = await chromium.launch({
    proxy: { server: configuration.proxy, bypass: '<-loopback>' },
    ...(process.env.DIAGNOSTIC_CHROME_PATH ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  stage = 'page-navigation';
  await page.goto(configuration.origin);
  stage = 'request';
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
} catch (error) {
  // 仅输出受控阶段及已知原因，绝不输出异常正文、启动命令或连接参数。
  const reason = error.code === 'ERR_MODULE_NOT_FOUND' ? 'module-not-found'
    : stage === 'browser-launch' ? 'browser-launch-failed' : 'unclassified';
  console.error(JSON.stringify({ event: 'settlement-browser-failure', stage, reason }));
  process.exitCode = 1;
} finally { if (browser) await browser.close(); }
"""


def browser_working_directory(repository=None, invocation_directory=None):
    """优先使用调用方已安装的依赖；画面独立安装时从画面目录启动。"""
    repository = ROOT if repository is None else repository
    invocation_directory = Path.cwd() if invocation_directory is None else invocation_directory
    return installed_browser_project(browser_projects(repository, invocation_directory))


def browser_failure_diagnostic(stderr):
    """只接受子进程有限诊断字段，未知输出不作为可公开异常内容。"""
    for line in reversed(stderr.splitlines()[-10:]):
        if diagnostic := browser_diagnostic_line(line):
            return f"stage={diagnostic['stage']} reason={diagnostic['reason']}"
    return 'stage=unclassified reason=unclassified'


def browser_projects(repository, invocation_directory):
    """显式子项目调用只使用本项目版本，根目录调用按安装位置选择。"""
    projects = (repository, repository / 'visual', repository / 'e2e')
    return (invocation_directory,) if invocation_directory in projects[1:] else projects


def installed_browser_project(candidates):
    """缺少锁定浏览器依赖时明确失败，禁止空跑。"""
    for directory in candidates:
        if (directory / 'node_modules/@playwright/test/package.json').is_file():
            return directory
    raise AssertionError('真实浏览器依赖未安装：reason=module-not-found；请在调用子项目安装锁定依赖和浏览器。')


def browser_diagnostic_line(line):
    """仅解析长度受限的子进程 JSON 诊断行。"""
    if len(line) > 512:
        return None
    try:
        return validated_browser_diagnostic(json.loads(line))
    except ValueError:
        return None


def validated_browser_diagnostic(diagnostic):
    """先确认对象形状，再验证全部公开字段的固定枚举。"""
    if not isinstance(diagnostic, dict):
        return None
    valid = all((diagnostic.get('event') == 'settlement-browser-failure',
                 diagnostic.get('stage') in ('module-import', 'browser-launch', 'page-navigation', 'request'),
                 diagnostic.get('reason') in ('module-not-found', 'browser-launch-failed', 'unclassified')))
    return diagnostic if valid else None


def page_response(path):
    """测试页面可读取，其他真实业务请求保持 503 失败对照。"""
    if path == '/':
        return 200, 'text/html', '<!doctype html><title>本机预检对照</title>'.encode()
    return 503, 'application/json', b'{"ok":false}'


class Upstream(BaseHTTPRequestHandler):
    """为结算预检测试提供可挂起的真实上游预检及业务失败响应。"""
    def do_OPTIONS(self):
        """记录 OPTIONS 请求，按测试条件挂起或返回真实预检响应。"""
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
        """为测试页面返回 HTML，为真实业务读取返回 503。"""
        path = urlsplit(self.path).path
        self.server.requests.append(('GET', path))
        status, content_type, content = page_response(path)
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        """记录建房 POST 并返回有效的合成房间标识。"""
        path = urlsplit(self.path).path
        self.server.requests.append(('POST', path))
        content = json.dumps({'ok': True, 'result': {'room_id': ROOM}}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_arguments):
        """抑制本机上游访问日志，保持预检诊断输出可断言。"""
        pass


class SettlementPreflightTests(unittest.TestCase):
    """通过真实浏览器与代理验证结算空榜预检的来源边界。"""
    def setUp(self):
        """启动可控上游与真实代理，准备结算预检的浏览器测试环境。"""
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
        self.wait_proxy()
        self.control('/scenario', {'scenario': 'visual-stable'})
        # 必须先观察成功的建房响应；直接赋值不能验证生产绑定链路。
        self.request('http://node-0.service.invalid/v3/pay_action/do', 'POST', {
            'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': 'zhajinhua'},
        })

    def stop_upstream(self):
        """释放挂起的预检并关闭本机上游服务。"""
        self.upstream.release_preflight.set()
        self.upstream.shutdown()
        self.upstream.server_close()

    def stop_proxy(self):
        """终止结算测试代理，超时后强制回收。"""
        self.proxy.terminate()
        try:
            self.proxy.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proxy.kill()
            self.proxy.wait(timeout=5)

    def request(self, address, method='GET', body=None):
        """通过本机代理请求目标地址并读取状态及响应正文。"""
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, address, None if body is None else json.dumps(body),
                               {'X-E2E-Control-Token': 'offline-token'})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def control(self, path, body=None):
        """向代理控制入口发送读取或 JSON 控制命令。"""
        return self.request('http://test-mitmproxy.invalid' + path, 'GET' if body is None else 'POST', body)

    def browse(self, path=SETTLEMENT, **options):
        """启动真实浏览器访问指定结算地址并解析观察结果。"""
        configuration = {'proxy': f'http://127.0.0.1:{self.port}', 'origin': self.origin,
                         'target': 'http://node-0.service.invalid' + path, **options}
        directory = browser_working_directory()
        completed = subprocess.run(['node', '--input-type=module', '-e', BROWSER, json.dumps(configuration)],
                                   cwd=directory, capture_output=True, text=True, timeout=20)
        project = {ROOT: '仓库根目录', ROOT / 'visual': '画面子项目', ROOT / 'e2e': '端到端子项目'}
        self.assertEqual(completed.returncode, 0,
                         f'真实浏览器对照未完成：上下文={project.get(directory, "隔离布局")} '
                         + browser_failure_diagnostic(completed.stderr)
                         + '；请核对调用子项目的锁定依赖及浏览器安装。')
        return json.loads(completed.stdout)

    def test_独立依赖布局均能启动真实浏览器并保留预检负例(self):
        """验证独立依赖布局均能启动真实浏览器并保留预检负例。"""
        modules = browser_working_directory() / 'node_modules'
        for project in ('visual', 'e2e', ''):
            with self.subTest(project=project), tempfile.TemporaryDirectory() as temporary:
                repository = Path(temporary)
                directory = repository / project
                directory.mkdir(parents=True, exist_ok=True)
                (directory / 'node_modules').symlink_to(modules, target_is_directory=True)
                invocation = directory if project == 'e2e' else repository
                selected = browser_working_directory(repository, invocation)
                self.assertEqual(selected, directory, '只能使用该隔离布局中已安装的子项目依赖')
                with patch(__name__ + '.browser_working_directory', return_value=selected):
                    self.assertEqual(self.browse()['status'], 200)
                    self.assertEqual(self.browse(extraHeaders={'X-Unknown': 'offline'})['outcome'], 'TimeoutError',
                                     '不同启动布局不能跳过未知请求头的真实浏览器负例')

    def test_上游预检无响应时当前房间仍通过本地预检读取空榜(self):
        """验证上游预检无响应时当前房间仍通过本地预检读取空榜。"""
        observed = self.browse()
        self.assertEqual(observed, {'outcome': 'response', 'status': 200,
                                   'body': {'ok': True, 'result': {'settlements': []}}})
        self.assertNotIn(('OPTIONS', SETTLEMENT), self.upstream.requests, '必要夹具预检不能依赖上游')
        self.assertNotIn(('GET', SETTLEMENT), self.upstream.requests, '读取必须命中当前房间夹具')
        _, diagnostic = self.control('/diagnostics')
        responses = self.fixture_reads(diagnostic['events'])
        self.assertEqual(set(field_values(responses, 'method')), {'GET', 'OPTIONS'})

    def test_不匹配预检仍依赖上游且真实业务失败保持失败(self):
        """验证不匹配预检仍依赖上游且真实业务失败保持失败。"""
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

    def wait_proxy(self):
        """按原有启动预算等待真实控制入口。"""
        deadline = time.monotonic() + 15
        while True:
            if self.proxy_ready():
                return
            self.check_proxy_alive(deadline)
            time.sleep(0.1)

    def proxy_ready(self):
        """仅连接未就绪时继续轮询，其他异常仍传播。"""
        try:
            self.control('/status')
            return True
        except OSError:
            return False

    def check_proxy_alive(self, deadline):
        """进程退出或原有预算耗尽时阻断测试。"""
        if self.proxy.poll() is not None or time.monotonic() >= deadline:
            self.fail('本机生产代理启动失败')

    def fixture_reads(self, events):
        """仅选择 GET 和 OPTIONS 的本地夹具响应。"""
        responses = events_named(events, 'proxy.response')
        return [event for event in responses if self.fixture_read(event)]

    def fixture_read(self, event):
        """区分本地夹具响应及真实上游响应。"""
        return event.get('method') in ('GET', 'OPTIONS') and event.get('source') == 'fixture'


if __name__ == '__main__':
    unittest.main()
