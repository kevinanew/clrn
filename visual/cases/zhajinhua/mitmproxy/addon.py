"""拼三张独立代理：应用动态选线，只回放本例真实创建的私人房。"""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from zhajinhua_replay import UUID, PLAYER_IDS, ZhajinhuaReplay

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles  # noqa: E402

from replay_scenes import publish_scene  # noqa: E402
from connection_diagnostics import ConnectionDiagnostics  # noqa: E402
from visual_control import control, respond, route_request  # noqa: E402

diagnostics = ConnectionDiagnostics()


def respond_settlement_preflight(flow):
    """仅为本轮本地 Release 页面的必要读取预检响应，不扩大其他业务的跨域范围。"""
    if (flow.request.method != 'OPTIONS'
            or flow.request.headers.get('Access-Control-Request-Method') != 'GET'):
        return False
    try:
        release = urlsplit(os.environ.get('CLRN_RELEASE_WEB_URL', ''))
        if (release.scheme != 'http' or release.hostname != '127.0.0.1' or not release.port
                or release.username or release.password or release.path not in ('', '/')
                or release.query or release.fragment):
            return False
        origin = f'http://127.0.0.1:{release.port}'
    except ValueError:
        return False
    if flow.request.headers.get('Origin') != origin:
        return False
    requested_headers = flow.request.headers.get('Access-Control-Request-Headers', '')
    names = {name.strip().lower() for name in requested_headers.split(',')}
    # 固定应用的 ApiHeaderFactory 使用这些头；未知头仍交由真实上游判断。
    if not names <= {'accept', 'accept-language', 'content-type', 'app-id', 'app-version', 'authorization'}:
        return False
    flow.response = http.Response.make(204, b'', {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': requested_headers,
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    })
    return True


class ZhajinhuaVisualProxy:
    """管理炸金花视觉场景、真实建房绑定及牌桌回放。"""
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

    def command(self, path, body):
        """执行炸金花场景切换、牌桌重放与操作奖励控制命令。"""
        if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
            self.scenario = body['scenario']
            self.replay.release()
            self.created_room_id = None
        elif self.scenario == 'visual-stable' and path == '/zhajinhua/replay':
            if set(body) != {'roomId', 'scene'}:
                raise ValueError('Only named scenes are accepted')
            if not self.created_room_id or body.get('roomId') != self.created_room_id:
                raise ValueError('Replay requires this test room')
            publish_scene(self.replay, body.get('roomId'), body.get('scene'), 'zhajinhua')
        elif self.scenario == 'visual-stable' and path == '/zhajinhua/operation-reward':
            self.replay.set_operation_reward(body.get('roomId'), body.get('enabled'))
        elif path == '/zhajinhua/release':
            self.replay.release()
            self.created_room_id = None
        else:
            raise ValueError('Unknown command')

    def status(self):
        """返回炸金花场景、请求命中及重放消息计数。"""
        return {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.replay.replayed_messages, 'blockedRpcs': self.replay.blocked_rpcs,
        }

    def response(self, flow):
        """在有效场景中覆盖虚拟玩家资料并观察真实建房响应。"""
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        path = urlsplit(flow.request.path).path
        if self.replay.room_id and path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.replay.self_id,
                {player: self.replay.profile(player) for player in PLAYER_IDS})
        if (flow.request.method != 'POST' or path != '/v3/pay_action/do'
                or not flow.response or flow.response.status_code != 200 or self.created_room_id):
            return
        try:
            request = json.loads(flow.request.content)
            action = request.get('action_url')
            config = request.get('action_json')
            body = json.loads(flow.response.content)
            room_id = body.get('result', {}).get('room_id')
            if (isinstance(action, dict) and isinstance(config, dict)
                    and action.get('method') == 'POST'
                    and action.get('path') in ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')
                    and config.get('game_type') == 'zhajinhua' and body.get('ok') is True
                    and isinstance(room_id, str) and re.fullmatch(UUID, room_id, re.I)):
                self.created_room_id = room_id
        except (ValueError, TypeError, AttributeError):
            return

    def websocket_message(self, flow):
        """在有效炸金花场景中处理 staging WebSocket 消息。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.replay.websocket_message(flow)

    def websocket_end(self, flow):
        """连接关闭时清理炸金花重放订阅。"""
        self.replay.websocket_end(flow)

    def request(self, flow):
        """路由控制及业务请求，仅为已创建房间的限定读取提供夹具。"""
        if not route_request(self, flow, diagnostics, is_staging):
            return
        path = urlsplit(flow.request.path).path
        # 仅当前真实创建的房间使用固定空榜；其他房间和节点健康请求继续透传。
        if self.created_room_id and path == f'/v1/game_log/room/{self.created_room_id}/settlement':
            if flow.request.method == 'GET':
                respond(flow, {'ok': True, 'result': {'settlements': []}})
            elif not respond_settlement_preflight(flow):
                return
            self.stabilized_requests += 1
            return
        if self.replay.room_id and prepare_profiles(flow, self.replay.self_id, PLAYER_IDS):
            return
        if flow.request.method == 'GET' or (flow.request.method == 'PUT' and path == '/v10/profile/users'):
            try:
                fixture = self.replay.http_fixture(path, flow.request.content)
            except (ValueError, TypeError, AttributeError):
                return
            if fixture is None:
                return
            data, status = {'ok': True, 'result': fixture}, 200
        else:
            return
        respond(flow, data, status)
        self.stabilized_requests += 1


addons = [ZhajinhuaVisualProxy(), diagnostics]
