"""我的战绩独立代理；数据仅匹配控制端指定的账号和固定记录。"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from data import HOUSE, PLAYER
from record_routes import RecordFixtures

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402
from visual_control import respond as respond_json  # noqa: E402

from connection_diagnostics import ConnectionDiagnostics  # noqa: E402

diagnostics = ConnectionDiagnostics()

CONTROL_HOST = 'test-mitmproxy.invalid'
MODES = ('empty', 'list', 'no-hands', 'paged', 'list-error', 'detail-error', 'delete-error')


def respond(flow, result, status=200, wrapped=True):
    """可选包装成功业务结构后发送战绩 JSON 响应。"""
    data = {'ok': True, 'result': result} if wrapped else result
    respond_json(flow, data, status)


class GameRecordProxy(RecordFixtures):
    """提供战绩新旧版本的分页、编辑、删除与重放展示夹具。"""
    def __init__(self):
        """初始化token、scenario、user_id、version、mode等状态。"""
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.user_id = None
        self.version = 'legacy'
        self.mode = 'empty'
        self.deleted = []
        self.hold = asyncio.Event()
        self.hold.set()
        self.counts = {}
        self.faults = {}
        self.proxied = 0
        self.stabilized = 0

    def status(self):
        """返回战绩场景、请求计数及删除状态等观测数据。"""
        return {'scenario': self.scenario, 'interceptedRequests': sum(self.counts.values()),
                'proxiedRequests': self.proxied, 'stabilizedRequests': self.stabilized,
                'recordRequests': self.counts, 'faultRequests': self.faults, 'deleted': self.deleted}

    def control(self, flow):
        """验证控制令牌后执行命令，非法输入仍返回 400。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403, False)
            return
        self.control_command(flow)

    def control_command(self, flow):
        """保持原有控制错误传播到 HTTP 响应的边界。"""
        try:
            self.command(flow.request.method, urlsplit(flow.request.path).path, flow.request.content)
        except (ValueError, KeyError, TypeError, AttributeError):
            respond(flow, {'error': 'Invalid command'}, 400, False)
            return
        respond(flow, self.status(), wrapped=False)

    def command(self, method, path, content):
        """POST 解析命令，GET 只接受状态入口。"""
        if method == 'POST':
            self.post_command(path, json.loads(content))
        elif (method, path) != ('GET', '/status'):
            raise ValueError('Unknown command')

    def post_command(self, path, body):
        """场景命令优先于其余控制入口。"""
        if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
            self.set_scenario(body)
            return
        self.record_command(path, body)

    def record_command(self, path, body):
        """释放无需活动场景，其余入口校验场景后处理。"""
        if path == '/records/release':
            self.hold.set()
            return
        self.configure_command(path, body)

    def set_scenario(self, body):
        """切换场景时清除账号及删除状态并释放等待请求。"""
        self.scenario = body['scenario']
        self.user_id = None
        self.deleted = []
        self.hold.set()

    def configure_command(self, path, body):
        """仅活动场景接受模式和账号配置。"""
        self.validate_configure(path)
        mode, hold = body.get('mode'), body.get('hold', False)
        self.validate_mode(mode, hold)
        if path == '/records/configure':
            self.configure_user(body)
        self.mode = mode
        self.hold.clear() if hold else self.hold.set()

    def validate_configure(self, path):
        """未知控制路径和无活动场景均拒绝。"""
        if self.scenario != 'visual-stable' or path not in ('/records/configure', '/records/mode'):
            raise ValueError('Unknown command')

    def validate_mode(self, mode, hold):
        """模式和挂起开关保持原有枚举与类型。"""
        if mode not in MODES or not isinstance(hold, bool):
            raise ValueError('Invalid mode')

    def configure_user(self, body):
        """校验完整账号和版本后才修改状态及计数。"""
        user_id, version = body.get('userId'), body.get('version')
        if not isinstance(user_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', user_id):
            raise ValueError('Invalid user')
        self.configure_version(user_id, version)

    def configure_version(self, user_id, version):
        """非法版本不会部分更新账号。"""
        if version not in ('legacy', 'v2'):
            raise ValueError('Invalid version')
        self.user_id, self.version = user_id, version
        self.deleted, self.counts, self.faults = [], {}, {}

    def active_request(self, flow):
        """只处理有效视觉场景的 staging 流量。"""
        return self.scenario == 'visual-stable' and is_staging(flow.request.host)

    def response(self, flow):
        """有效场景且账号绑定后，稳定资料和战绩版本响应。"""
        if not self.active_request(flow) or not self.user_id:
            return
        path = urlsplit(flow.request.path).path
        self.patch_response(flow, path)

    def patch_response(self, flow, path):
        """资料与版本使用独立的精确路由。"""
        if path == '/v10/profile/users':
            self.stabilized += patch_profiles(flow, self.user_id, {
                player: {'user_id': player, 'nickname': 'Opponent', 'avatarPath': ''} for player in (PLAYER, HOUSE)})
        self.patch_record_version(flow, path)

    def patch_record_version(self, flow, path):
        """只覆盖公开版本文件的 GET。"""
        if (flow.request.method, path) == ('GET', '/public/v11/game_log/available.json'):
            self.stabilized += patch_version(flow, 'v11' if self.version == 'v2' else 'v1')

    async def request(self, flow):
        """控制与业务请求分流，保留真实透传计数和场景边界。"""
        if flow.response:
            return
        if flow.request.host == CONTROL_HOST:
            self.dispatch_control(flow)
            return
        self.proxied += 1
        await self.business_request(flow)

    def dispatch_control(self, flow):
        """将诊断请求和场景控制请求分发到对应处理器。"""
        if flow.request.method == 'GET' and urlsplit(flow.request.path).path == '/diagnostics':
            diagnostics.control(flow)
        else:
            self.control(flow)

    async def business_request(self, flow):
        """优先准备真实资料读取，再按当前模式生成战绩。"""
        if not self.active_request(flow):
            return
        if self.prepare_read(flow):
            return
        await self.record_request(flow)

    def prepare_read(self, flow):
        """只有绑定账号可以准备混合玩家资料请求。"""
        return self.user_id and prepare_profiles(flow, self.user_id, (PLAYER, HOUSE))

    async def record_request(self, flow):
        """结构错误继续透传，只有命中夹具才记数及等待。"""
        url = urlsplit(flow.request.path)
        fixture = self.read_fixture(flow, url)
        if fixture is None:
            return
        path, method = url.path, flow.request.method
        self.counts[path] = self.counts.get(path, 0) + 1
        is_list = path.endswith('/game_records') or path.endswith('/recent')
        await self.wait_list(is_list, url)
        self.respond_record(flow, path, method, fixture, is_list)

    def read_fixture(self, flow, url):
        """保留原有 JSON 和数据错误捕获范围。"""
        try:
            body = json.loads(flow.request.content or b'{}')
            return self.fixture(url.path, flow.request.method, body, parse_qs(url.query))
        except (ValueError, TypeError, KeyError, AttributeError):
            return None

    async def wait_list(self, is_list, url):
        """分页首页不挂起，续页和其他列表遵守原等待事件。"""
        if is_list and self.held_page(url):
            await self.hold.wait()

    def held_page(self, url):
        """分页模式仅固定游标查询触发等待。"""
        return self.mode != 'paged' or parse_qs(url.query).get('next_page')

    def should_fail(self, path, method, is_list):
        """固定故障模式只作用于原有接口类别。"""
        failures = {
            # 列表故障只匹配列表请求。
            'list-error': lambda: is_list,
            # 详情故障排除 recent 列表入口。
            'detail-error': lambda: '/play_session_record/' in path and not is_list,
            # 删除故障只匹配 DELETE 方法。
            'delete-error': lambda: method == 'DELETE',
        }
        # 未配置的模式不触发故障。
        return failures.get(self.mode, lambda: False)()

    def respond_record(self, flow, path, method, fixture, is_list):
        """保持列表 HTTP 503 和其他业务错误的不同语义。"""
        if self.should_fail(path, method, is_list):
            self.faults[path] = self.faults.get(path, 0) + 1
            status = 503 if self.mode == 'list-error' else 200
            respond(flow, {'ok': False, 'error_type': 'visual_record_unavailable',
                           'error_message': 'Visual record service unavailable',
                           'message': 'Visual record service unavailable'}, status, False)
        else:
            respond(flow, fixture)


addons = [GameRecordProxy(), diagnostics]
