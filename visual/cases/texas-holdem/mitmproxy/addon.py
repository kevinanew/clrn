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

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

from replay_scenes import publish_scene  # noqa: E402
from connection_diagnostics import ConnectionDiagnostics  # noqa: E402
from visual_control import control, respond, route_request  # noqa: E402

diagnostics = ConnectionDiagnostics()


class TexasVisualProxy:
    """管理德州视觉场景、房间资料缓存、重放与界面状态夹具。"""
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

    def command(self, path, body):
        """执行德州场景、重放、房间展示与界面状态控制命令。"""
        if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
            self.scenario = body['scenario']
            self.texas.release()
            self.view.configure(None)
            self.records.release()
            self.ui.release()
            self.room_profile.release()
        elif self.scenario == 'visual-stable' and path == '/texas/view':
            self.view.configure(body.get('mode'))
        elif self.scenario == 'visual-stable' and path == '/texas/replay':
            if set(body) != {'roomId', 'scene'}:
                raise ValueError('Only named scenes are accepted')
            publish_scene(self.texas, body.get('roomId'), body.get('scene'), 'texas')
        elif self.scenario == 'visual-stable' and path == '/texas/records':
            self.records.configure(body.get('empty'))
            if self.view.mode != 'record-v2':
                self.view.configure('record-v2')
        elif self.scenario == 'visual-stable' and path == '/texas/ui' and self.texas.room_id:
            self.ui.configure(body)
            self.texas.ui_states = self.ui
        elif path == '/texas/release':
            self.texas.release()
            self.room_profile.release()
            self.view.configure(None)
            self.records.release()
            self.ui.release()
        else:
            raise ValueError('Unknown command')

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
        """记录真实房间资料并按当前视觉场景覆盖限定响应字段。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.room_profile.observe(flow, self.texas.room_id, self.texas.self_id)
            path = urlsplit(flow.request.path).path
            if self.texas.room_id and path == '/v10/profile/users':
                self.stabilized_requests += patch_profiles(flow, self.texas.self_id,
                    {player: self.texas.profile(player) for player in TABLE_PLAYER_IDS})
            if self.records.enabled and flow.request.method == 'GET' and path == '/public/v11/game_log/available.json':
                self.stabilized_requests += patch_version(flow, 'v11')
            self.view.response(flow, path)
            try:
                self.records.response(flow, path, self.view.room_id)
            except (ValueError, TypeError, AttributeError):
                pass
            if self.view.room_id and not self.texas.room_id:
                # 大厅入口会自动请求入座；从房间创建响应开始隔离其 RPC，避免真实带入。
                self.texas.arm_created_room(self.view.room_id, self.view.self_id)
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
        """路由德州控制、虚拟玩家预检和当前场景业务请求。"""
        if not route_request(self, flow, diagnostics, is_staging):
            return
        if respond_virtual_player_preflight(flow, self.texas.room_id):
            self.stabilized_requests += 1
            return
        if self.prepare_read(flow):
            return
        path = urlsplit(flow.request.path).path
        try:
            fixture = self.ui.fixture(flow.request.path, flow.request.method, flow.request.content, self.texas.room_id)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        fixture = self.records.fixture(path, flow.request.method, self.texas.self_id)
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        try:
            fixture = self.view.fixture(path, flow.request.method, self.texas.self_id, flow.request.content)
            if fixture is None:
                fixture = log_fixture(path, flow.request.method, flow.request.content,
                                      self.texas.room_id, self.texas.self_id)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        self.respond_replay(flow, path)

    def respond_replay(self, flow, path):
        """仅为当前重放房间返回限定的黑名单、战绩及读取夹具。"""
        if self.texas.room_id and path == '/v1/hall_matching/blacklist' and flow.request.method in ('POST', 'DELETE'):
            try:
                player_id = json.loads(flow.request.content).get('black_user_id')
            except (ValueError, TypeError, AttributeError):
                return
            if player_id not in PLAYER_IDS:
                return
            data, status = {'ok': True, 'result': {}}, 200
        elif flow.request.method == 'GET' or (flow.request.method == 'PUT' and path == '/v10/profile/users'):
            try:
                fixture = self.texas.http_fixture(path, flow.request.content)
            except (ValueError, TypeError, AttributeError):
                return
            if fixture is None:
                return
            data, status = {'ok': True, 'result': fixture}, 200
        else:
            return
        respond(flow, data, status)
        self.stabilized_requests += 1


addons = [TexasVisualProxy(), diagnostics]
