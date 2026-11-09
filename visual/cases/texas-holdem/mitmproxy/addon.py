"""德州视觉测试专用代理；App 和其他玩法不会加载此脚本。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from texas_replay import PLAYER_IDS, TABLE_PLAYER_IDS, TexasReplay
from room_view import RoomView
from game_log import fixture as log_fixture
from records_v2 import RecordsV2
from ui_states import UIStates
from virtual_player_preflight import respond_virtual_player_preflight
from room_profile import RoomProfile
from fixture_protocol import VisualCommands

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

from replay_scenes import publish_scene  # noqa: E402
from connection_diagnostics import ConnectionDiagnostics  # noqa: E402
from visual_control import control, respond, route_request  # noqa: E402

diagnostics = ConnectionDiagnostics()


class TexasVisualProxy(VisualCommands):
    """管理德州视觉场景、房间资料缓存、重放与界面状态夹具。"""
    release_path = '/texas/release'

    def __init__(self):
        """初始化token、scenario、proxied_requests、stabilized_requests、texas等状态。"""
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.texas = TexasReplay()
        self.view = RoomView()
        self.records = RecordsV2()
        self.ui = UIStates()
        self.room_profile = RoomProfile()

    def control(self, flow):
        """通过共用认证入口分发德州代理控制请求。"""
        control(self, flow, respond, self.command, self.status)

    def active_command(self, path, body):
        """未知命令仍抛出控制错误。"""
        # 视图命令只传入展示模式字段。
        routes = {'/texas/view': lambda: self.view.configure(body.get('mode')),
                  # 回放命令在分发后验证命名场景。
                  '/texas/replay': lambda: self.replay_command(body),
                  # 记录命令按正文配置空态。
                  '/texas/records': lambda: self.records_command(body),
                  # 界面命令在分发后校验房间绑定。
                  '/texas/ui': lambda: self.ui_command(body)}
        handler = routes.get(path)
        if handler is None:
            raise ValueError('Unknown command')
        handler()

    def release(self):
        """释放所有房间、资料、记录和界面绑定。"""
        self.texas.release()
        self.room_profile.release()
        self.view.configure(None)
        self.records.release()
        self.ui.release()

    def replay_command(self, body):
        """只接受命名场景，不接受任意帧注入。"""
        if set(body) != {'roomId', 'scene'}:
            raise ValueError('Only named scenes are accepted')
        publish_scene(self.texas, body.get('roomId'), body.get('scene'), 'texas')

    def records_command(self, body):
        """记录模式切换保持原有房间视图重置规则。"""
        self.records.configure(body.get('empty'))
        if self.view.mode != 'record-v2':
            self.view.configure('record-v2')

    def ui_command(self, body):
        """界面状态要求已绑定回放房间。"""
        if not self.texas.room_id:
            raise ValueError('Unknown command')
        self.ui.configure(body)
        self.texas.ui_states = self.ui

    def status(self):
        """返回德州场景、代理请求及重放消息的观测计数。"""
        return {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.texas.replayed_messages,
        }

    def websocket_message(self, flow):
        """在有效德州场景中处理 staging WebSocket 消息。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.texas.websocket_message(flow)

    def websocket_end(self, flow):
        """连接关闭时清理德州重放订阅状态。"""
        self.texas.websocket_end(flow)

    def response(self, flow):
        """只观察有效场景中真实 staging 响应。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.observe_response(flow)

    def observe_response(self, flow):
        """按原顺序观察资料、稳定字段和记录，再绑定创建房间。"""
        self.room_profile.observe(flow, self.texas.room_id, self.texas.self_id)
        path = urlsplit(flow.request.path).path
        self.patch_players(flow, path)
        self.patch_version(flow, path)
        self.view.response(flow, path)
        self.observe_records(flow, path)
        self.bind_created_view()

    def patch_players(self, flow, path):
        """仅绑定回放房间后补充虚拟玩家资料。"""
        if not self.texas.room_id:
            return
        if path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.texas.self_id,
                self.virtual_profiles())

    def virtual_profiles(self):
        """构造已登记虚拟对手的稳定资料。"""
        return {player: self.texas.profile(player) for player in TABLE_PLAYER_IDS}

    def patch_version(self, flow, path):
        """只有启用新版战绩才稳定公开版本 GET。"""
        if not self.records.enabled:
            return
        if (flow.request.method, path) == ('GET', '/public/v11/game_log/available.json'):
            self.stabilized_requests += patch_version(flow, 'v11')

    def observe_records(self, flow, path):
        """保持入场记录结构异常的忽略边界。"""
        try:
            self.records.response(flow, path, self.view.room_id)
        except (ValueError, TypeError, AttributeError):
            pass

    def bind_created_view(self):
        """从真实创建响应起隔离自动入座，避免真实带入。"""
        if self.view.room_id and not self.texas.room_id:
            self.texas.arm_created_room(self.view.room_id, self.view.self_id)
        self.bind_view_player()

    def bind_view_player(self):
        """仅补齐尚未绑定的当前玩家。"""
        if self.view.self_id and not self.texas.self_id:
            self.texas.self_id = self.view.self_id

    def prepare_read(self, flow):
        """优先复用当前房间的真实资料缓存，否则准备限定的展示读取。"""
        profile = self.room_profile.read(flow, self.texas.room_id, self.texas.self_id)
        if profile is not None:
            respond(flow, profile)
            self.stabilized_requests += 1
            return True
        return self.texas.room_id and prepare_profiles(flow, self.texas.self_id, TABLE_PLAYER_IDS)

    def request(self, flow):
        """路由控制与预检后，再处理当前场景读取。"""
        if not route_request(self, flow, diagnostics, is_staging):
            return
        if respond_virtual_player_preflight(flow, self.texas.room_id):
            self.stabilized_requests += 1
            return
        self.read_request(flow)

    def read_request(self, flow):
        """真实资料缓存优先，界面夹具解析错误直接透传。"""
        if self.prepare_read(flow):
            return
        try:
            fixture = self.ui.fixture(flow.request.path, flow.request.method, flow.request.content, self.texas.room_id)
        except (ValueError, TypeError, AttributeError):
            return
        self.respond_ui(flow, fixture)

    def send_fixture(self, flow, fixture):
        """命中夹具时包装业务结果并更新稳定次数。"""
        if fixture is None:
            return False
        respond(flow, {'ok': True, 'result': fixture})
        self.stabilized_requests += 1
        return True

    def respond_ui(self, flow, fixture):
        """界面、记录、视图和重放夹具保持原优先级。"""
        if self.send_fixture(flow, fixture):
            return
        path = urlsplit(flow.request.path).path
        fixture = self.records.fixture(path, flow.request.method, self.texas.self_id)
        if self.send_fixture(flow, fixture):
            return
        self.respond_view(flow, path)

    def respond_view(self, flow, path):
        """视图或日志解析错误继续透传。"""
        try:
            fixture = self.view_fixture(flow, path)
        except (ValueError, TypeError, AttributeError):
            return
        if not self.send_fixture(flow, fixture):
            self.respond_replay(flow, path)

    def view_fixture(self, flow, path):
        """视图优先于本房间游戏日志。"""
        fixture = self.view.fixture(path, flow.request.method, self.texas.self_id, flow.request.content)
        if fixture is None:
            return log_fixture(path, flow.request.method, flow.request.content, self.texas.room_id, self.texas.self_id)
        return fixture

    def respond_replay(self, flow, path):
        """黑名单与虚拟玩家读取各自保留严格入口约束。"""
        if self.blacklist_request(flow, path):
            self.respond_blacklist(flow)
            return
        if self.replay_read(flow, path):
            self.respond_http_fixture(flow, path)

    def blacklist_request(self, flow, path):
        """只有回放房间可以匹配黑名单路径。"""
        if not self.texas.room_id:
            return False
        return path == '/v1/hall_matching/blacklist' and flow.request.method in ('POST', 'DELETE')

    def respond_blacklist(self, flow):
        """只为固定虚拟对手返回空操作结果。"""
        try:
            player_id = json.loads(flow.request.content).get('black_user_id')
        except (ValueError, TypeError, AttributeError):
            return
        if player_id in PLAYER_IDS:
            self.send_fixture(flow, {})

    def replay_read(self, flow, path):
        """GET 或玩家资料批次 PUT 才能进入回放读取。"""
        return flow.request.method == 'GET' or (flow.request.method, path) == ('PUT', '/v10/profile/users')

    def respond_http_fixture(self, flow, path):
        """原有读取错误不补成功响应。"""
        try:
            fixture = self.texas.http_fixture(path, flow.request.content)
        except (ValueError, TypeError, AttributeError):
            return
        self.send_fixture(flow, fixture)


addons = [TexasVisualProxy(), diagnostics]
