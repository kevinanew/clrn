"""为俱乐部已加入列表和牌局截图提供隔离的固定业务响应，其他请求继续透传。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http

sys.path.insert(0, str(Path(__file__).resolve().parent))
from joined_clubs import JOINED_CLUB_IDENTIFIERS, JOINED_CLUBS  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
CLUB_IDENTIFIER = '00000000-0000-4000-8000-000000000151'
CLUB_NAME = '演示俱乐部'
CLUB_ROOMS = [
    {
        'room_id': 'visual-club-room-one', 'room_name': '德州体验局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 2,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 1, 'big_blind': 2,
                        'ante': 0, 'minimum_buy_in': 100, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
    {
        'room_id': 'visual-club-room-two', 'room_name': '周末牌局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 4,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 2, 'big_blind': 4,
                        'ante': 0, 'minimum_buy_in': 200, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
]


def respond(flow, result):
    """将固定结果按应用接口格式返回，并维持浏览器需要的跨域响应头。"""
    flow.response = http.Response.make(200, json.dumps(result).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class ClubRoomVisualProxy:
    """只在专用场景中匹配指定俱乐部及其房间，其他请求保持原路径。"""

    def __init__(self):
        """初始化俱乐部代理的控制令牌、场景、账号与请求计数。"""
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.user_id = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.club_room_requests = {}

    def status(self):
        """提供代理启动探测及业务响应计数，供截图断言确认流量来源。"""
        return {
            'scenario': self.scenario,
            'interceptedRequests': sum(self.club_room_requests.values()),
            'proxiedRequests': self.proxied_requests,
            'stabilizedRequests': self.stabilized_requests,
            'clubRoomRequests': self.club_room_requests,
        }

    def control(self, flow):
        """只接受带本轮随机令牌的场景控制与状态查询。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            flow.response = http.Response.make(403, b'{}')
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method == 'POST' and path == '/scenario':
            try:
                command = json.loads(flow.request.content)
                scenario = command['scenario']
                user_id = command.get('userId')
            except (ValueError, KeyError, TypeError):
                scenario = False
                user_id = None
            if scenario not in (None, 'visual-stable', 'club-list-populated') or (
                scenario == 'club-list-populated' and (not isinstance(user_id, str) or not user_id)
            ):
                flow.response = http.Response.make(400, b'{}')
                return
            self.scenario = scenario
            self.user_id = user_id if scenario == 'club-list-populated' else None
            self.club_room_requests = {}
        elif flow.request.method != 'GET' or path != '/status':
            flow.response = http.Response.make(400, b'{}')
            return
        respond(flow, self.status())

    def fixture(self, flow):
        """校验请求方法、目标俱乐部及请求正文后，返回固定业务结果。"""
        url = urlsplit(flow.request.path)
        path = url.path
        method = flow.request.method
        if self.scenario == 'club-list-populated':
            return self.joined_clubs_fixture(flow)
        if path == '/v10/club' and method == 'GET' and parse_qs(url.query).get('user_id'):
            return {'clubs': [{'id': CLUB_IDENTIFIER}]}
        if method != 'PUT':
            return None
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None
        if path == '/v10/clubs' and body.get('club_ids') == [CLUB_IDENTIFIER]:
            return [{
                'id': CLUB_IDENTIFIER, 'club_id': CLUB_IDENTIFIER, 'club_no': 151,
                'name': CLUB_NAME, 'owner': {'id': 'visual-club-owner', 'role': 'owner'},
                'owner_id': 'visual-club-owner', 'admin_ids': [],
                'create_room_role': ['owner'], 'room_amount': 2,
            }]
        if path == '/v2/building/rooms' and body.get('building_ids') == [CLUB_IDENTIFIER]:
            return CLUB_ROOMS
        return None

    def joined_clubs_fixture(self, flow):
        """仅替换本轮账号的已加入列表和确切虚拟批次，虚拟俱乐部没有牌局。"""
        url = urlsplit(flow.request.path)
        if flow.request.method == 'GET' and url.path == '/v10/club':
            if parse_qs(url.query, keep_blank_values=True).get('user_id') == [self.user_id]:
                return {'clubs': [{'id': identifier} for identifier in JOINED_CLUB_IDENTIFIERS]}
            return None
        if flow.request.method == 'GET':
            for club in JOINED_CLUBS:
                if url.path == f"/v10/club/{club['id']}/profile":
                    return club
        if flow.request.method != 'PUT':
            return None
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None
        if not isinstance(body, dict):
            return None
        if url.path == '/v10/clubs' and body.get('club_ids') == JOINED_CLUB_IDENTIFIERS:
            return JOINED_CLUBS
        if url.path == '/v2/building/rooms' and body.get('building_ids') == JOINED_CLUB_IDENTIFIERS:
            return []
        return None

    def request(self, flow):
        """控制请求单独处理；业务请求必须经过场景和 staging 地址核对。"""
        if flow.response:
            return
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.scenario not in ('visual-stable', 'club-list-populated') or not is_staging(flow.request.host):
            return
        result = self.fixture(flow)
        if result is None:
            return
        path = urlsplit(flow.request.path).path
        self.club_room_requests[path] = self.club_room_requests.get(path, 0) + 1
        respond(flow, {'ok': True, 'result': result})


addons = [ClubRoomVisualProxy()]
