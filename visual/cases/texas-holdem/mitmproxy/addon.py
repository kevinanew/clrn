"""德州视觉测试专用代理；App 和其他玩法不会加载此脚本。"""

import json
import os
from urllib.parse import urlsplit
from mitmproxy import http
from texas_replay import PLAYER_IDS, TexasReplay
from room_view import RoomView
from game_log import fixture as log_fixture

CONTROL_HOST = 'test-mitmproxy.invalid'
PROXY_HOST = '64.kr-seoul.api.staging.laiwan.shafayouxi.com'


def is_staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


def respond(flow, data, status=200):
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class TexasVisualProxy:
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.texas = TexasReplay()
        self.view = RoomView()

    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403)
            return
        path = urlsplit(flow.request.path).path
        try:
            if flow.request.method == 'POST':
                body = json.loads(flow.request.content)
                if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
                    self.scenario = body['scenario']
                    self.texas.release()
                    self.view.configure(None)
                elif self.scenario == 'visual-stable' and path == '/texas/view':
                    self.view.configure(body.get('mode'))
                elif self.scenario == 'visual-stable' and path == '/texas/replay':
                    self.texas.publish(body.get('roomId'), body.get('data'))
                elif path == '/texas/release':
                    self.texas.release()
                    self.view.configure(None)
                else:
                    raise ValueError('Unknown command')
            elif flow.request.method != 'GET' or path != '/status':
                raise ValueError('Unknown command')
        except (ValueError, KeyError, TypeError, AttributeError):
            respond(flow, {'error': 'Invalid replay command'}, 400)
            return
        respond(flow, {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.texas.replayed_messages,
        })

    def websocket_message(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.texas.websocket_message(flow)

    def websocket_end(self, flow):
        self.texas.websocket_end(flow)

    def response(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.view.response(flow, urlsplit(flow.request.path).path)
            if self.view.room_id and not self.texas.room_id:
                # 大厅入口会自动请求入座；从房间创建响应开始隔离其 RPC，避免真实带入。
                self.texas.arm_created_room(self.view.room_id, self.view.self_id)
            if self.view.self_id and not self.texas.self_id:
                self.texas.self_id = self.view.self_id

    def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        path = urlsplit(flow.request.path).path
        try:
            fixture = self.view.fixture(path, flow.request.method, self.texas.self_id, flow.request.content)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is None:
            try:
                fixture = log_fixture(path, flow.request.method, flow.request.content,
                                      self.texas.room_id, self.texas.self_id)
            except (ValueError, TypeError, AttributeError):
                return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        if path == '/public/v13/metadata/servers':
            data = {'ok': True, 'result': {'servers': {PROXY_HOST: '127.0.0.1'}}}
            status = 200
        elif path == '/node/v1/status':
            selected = flow.request.host == PROXY_HOST
            data = {'backend_delay': 0, 'server_load': 'normal' if selected else 'unavailable'}
            status = 200 if selected else 503
        elif self.texas.room_id and path == '/v1/hall_matching/blacklist' and flow.request.method in ('POST', 'DELETE'):
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
        if flow.request.method == 'OPTIONS':
            flow.response.status_code = 204
            flow.response.content = b''
        self.stabilized_requests += 1


addons = [TexasVisualProxy()]
