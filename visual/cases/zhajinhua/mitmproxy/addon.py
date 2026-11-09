"""拼三张独立代理：应用动态选线，只回放本例真实创建的私人房。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from zhajinhua_replay import PLAYER_IDS, ZhajinhuaReplay
from replay_transport import valid_uuid
from fixture_protocol import (VisualCommands, is_read_preflight, preflight_response,
                              creation_action, successful_flow)

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles  # noqa: E402

from replay_scenes import publish_scene  # noqa: E402
from connection_diagnostics import ConnectionDiagnostics  # noqa: E402
from visual_control import control, respond, route_request  # noqa: E402

diagnostics = ConnectionDiagnostics()


def respond_settlement_preflight(flow):
    """只为本轮本地页面的 GET 读取提供严格预检。"""
    if not is_read_preflight(flow):
        return False
    return preflight_response(flow, http.Response.make)


class ZhajinhuaVisualProxy(VisualCommands):
    """管理炸金花视觉场景、真实建房绑定及牌桌回放。"""
    release_path = '/zhajinhua/release'

    def __init__(self):
        """初始化token、scenario、proxied_requests、stabilized_requests、created_room_id等状态。"""
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.created_room_id = None
        self.replay = ZhajinhuaReplay()

    def control(self, flow):
        """通过共用认证入口分发炸金花代理控制请求。"""
        control(self, flow, respond, self.command, self.status)

    def active_command(self, path, body):
        """仅分发命名回放与操作奖励。"""
        handlers = {'/zhajinhua/replay': self.replay_command,
                    '/zhajinhua/operation-reward': self.reward_command}
        handler = handlers.get(path)
        if handler is None:
            raise ValueError('Unknown command')
        handler(body)

    def release(self):
        """清除回放和真实创建房间归属。"""
        self.replay.release()
        self.created_room_id = None

    def replay_command(self, body):
        """只接受本轮创建房间的命名场景。"""
        if set(body) != {'roomId', 'scene'}:
            raise ValueError('Only named scenes are accepted')
        self.validate_created(body.get('roomId'))
        publish_scene(self.replay, body.get('roomId'), body.get('scene'), 'zhajinhua')

    def validate_created(self, room_id):
        """其他房间不能取得回放归属。"""
        if not self.created_room_id or room_id != self.created_room_id:
            raise ValueError('Replay requires this test room')

    def reward_command(self, body):
        """奖励参数由回放器校验。"""
        self.replay.set_operation_reward(body.get('roomId'), body.get('enabled'))

    def status(self):
        """返回炸金花场景、请求命中及重放消息计数。"""
        return {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.replay.replayed_messages, 'blockedRpcs': self.replay.blocked_rpcs,
        }

    def response(self, flow):
        """只观察有效视觉场景中的 staging 响应。"""
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        self.observe_response(flow)

    def observe_response(self, flow):
        """先稳定玩家资料，再观察首次真实建房。"""
        path = urlsplit(flow.request.path).path
        self.patch_players(flow, path)
        if self.is_creation(flow, path):
            self.observe_creation(flow)

    def patch_players(self, flow, path):
        """仅回放绑定后补充虚拟对手资料。"""
        if not self.replay.room_id:
            return
        if path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.replay.self_id,
                self.virtual_profiles())

    def virtual_profiles(self):
        """构造已登记虚拟对手的稳定资料。"""
        return {player: self.replay.profile(player) for player in PLAYER_IDS}

    def is_creation(self, flow, path):
        """只观察尚未绑定时的成功支付 POST。"""
        if self.created_room_id or not successful_flow(flow):
            return False
        return (flow.request.method, path) == ('POST', '/v3/pay_action/do')

    def observe_creation(self, flow):
        """JSON 与结构错误保留原有忽略边界。"""
        try:
            request = json.loads(flow.request.content)
            body = json.loads(flow.response.content)
            self.bind_created(request, body)
        except (ValueError, TypeError, AttributeError):
            return

    def bind_created(self, request, body):
        """创建动作与玩法均验证后才记录房间。"""
        room_id = body.get('result', {}).get('room_id')
        if not creation_action(request):
            return
        if request['action_json'].get('game_type') == 'zhajinhua':
            self.bind_successful(body, room_id)

    def bind_successful(self, body, room_id):
        """业务成功和合法 UUID 缺一不可。"""
        if body.get('ok') is True and valid_uuid(room_id):
            self.created_room_id = room_id

    def websocket_message(self, flow):
        """在有效炸金花场景中处理 staging WebSocket 消息。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.replay.websocket_message(flow)

    def websocket_end(self, flow):
        """连接关闭时清理炸金花重放订阅。"""
        self.replay.websocket_end(flow)

    def request(self, flow):
        """路由控制后优先处理本轮房间结算。"""
        if not route_request(self, flow, diagnostics, is_staging):
            return
        path = urlsplit(flow.request.path).path
        if self.is_settlement(path):
            self.respond_settlement(flow)
            return
        self.read_request(flow, path)

    def is_settlement(self, path):
        """只接受本次真实创建房间的确切结算路径。"""
        return self.created_room_id and path == f'/v1/game_log/room/{self.created_room_id}/settlement'

    def respond_settlement(self, flow):
        """结算 GET 返回固定空榜，其他方法仅接受限定预检。"""
        if flow.request.method == 'GET':
            respond(flow, {'ok': True, 'result': {'settlements': []}})
        elif not respond_settlement_preflight(flow):
            return
        self.stabilized_requests += 1

    def read_request(self, flow, path):
        """资料准备优先，其余请求保留原有读取方法边界。"""
        if self.prepare_read(flow):
            return
        if self.replay_read(flow, path):
            self.respond_read(flow, path)

    def prepare_read(self, flow):
        """只有回放绑定后才准备真实及虚拟资料批次。"""
        return self.replay.room_id and prepare_profiles(flow, self.replay.self_id, PLAYER_IDS)

    def replay_read(self, flow, path):
        """只让 GET 和资料批次 PUT 查询读取夹具。"""
        return flow.request.method == 'GET' or (flow.request.method, path) == ('PUT', '/v10/profile/users')

    def respond_read(self, flow, path):
        """非法读取正文继续透传。"""
        try:
            fixture = self.replay.http_fixture(path, flow.request.content)
        except (ValueError, TypeError, AttributeError):
            return
        self.send_fixture(flow, fixture)

    def send_fixture(self, flow, fixture):
        """命中读取夹具后才计数。"""
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1


addons = [ZhajinhuaVisualProxy(), diagnostics]
