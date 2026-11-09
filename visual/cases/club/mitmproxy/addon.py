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
        """验证令牌后处理场景与状态命令。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            flow.response = http.Response.make(403, b'{}')
            return
        if not self.control_request(flow):
            flow.response = http.Response.make(400, b'{}')
            return
        respond(flow, self.status())

    def control_request(self, flow):
        """仅接受场景 POST 和状态 GET。"""
        route = (flow.request.method, urlsplit(flow.request.path).path)
        if route == ('POST', '/scenario'):
            return self.scenario_command(flow.request.content)
        return route == ('GET', '/status')

    def scenario_command(self, content):
        """保留原有解析失败和缺字段的拒绝语义。"""
        try:
            command = json.loads(content)
            return self.configure_scenario(command['scenario'], command.get('userId'))
        except (ValueError, KeyError, TypeError):
            return False

    def configure_scenario(self, scenario, user_id):
        """完整验证场景后才更新账号绑定和计数。"""
        if scenario not in (None, 'visual-stable', 'club-list-populated'):
            return False
        if not self.valid_user(scenario, user_id):
            return False
        self.scenario = scenario
        self.user_id = self.scenario_user(scenario, user_id)
        self.club_room_requests = {}
        return True

    def valid_user(self, scenario, user_id):
        """已加入列表必须绑定非空字符串账号。"""
        if scenario != 'club-list-populated':
            return True
        return isinstance(user_id, str) and bool(user_id)

    def scenario_user(self, scenario, user_id):
        """其他场景不保留列表账号。"""
        return user_id if scenario == 'club-list-populated' else None

    def fixture(self, flow):
        """先分流已加入列表场景，再处理固定俱乐部。"""
        if self.scenario == 'club-list-populated':
            return self.joined_clubs_fixture(flow)
        return self.club_fixture(flow)

    def club_fixture(self, flow):
        """旧场景只匹配加入列表 GET 或固定批次 PUT。"""
        url = urlsplit(flow.request.path)
        if (flow.request.method, url.path) == ('GET', '/v10/club'):
            return self.single_club_list(url.query)
        return self.put_fixture(flow, self.single_club_batch)

    def single_club_list(self, query):
        """原场景允许任意非空 user_id 查询。"""
        if parse_qs(query).get('user_id'):
            return {'clubs': [{'id': CLUB_IDENTIFIER}]}
        return None

    def put_fixture(self, flow, build):
        """只解析 PUT 正文，JSON 解析失败继续透传。"""
        if flow.request.method != 'PUT':
            return None
        return self.parse_put(flow, build)

    def parse_put(self, flow, build):
        """业务结构错误沿用各场景本身的处理。"""
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None
        return build(urlsplit(flow.request.path).path, body)

    def single_club_batch(self, path, body):
        """固定俱乐部资料和房间批次必须精确相同。"""
        if path == '/v10/clubs' and body.get('club_ids') == [CLUB_IDENTIFIER]:
            return self.single_club()
        return self.single_club_rooms(path, body)

    def single_club(self):
        """保持卡片的创建者、权限和房间数。"""
        return [{
            'id': CLUB_IDENTIFIER, 'club_id': CLUB_IDENTIFIER, 'club_no': 151,
            'name': CLUB_NAME, 'owner': {'id': 'visual-club-owner', 'role': 'owner'},
            'owner_id': 'visual-club-owner', 'admin_ids': [],
            'create_room_role': ['owner'], 'room_amount': 2,
        }]

    def single_club_rooms(self, path, body):
        """房间读取不接收其他俱乐部。"""
        if path == '/v2/building/rooms' and body.get('building_ids') == [CLUB_IDENTIFIER]:
            return CLUB_ROOMS
        return None

    def joined_clubs_fixture(self, flow):
        """已加入列表仅为绑定账号、固定俱乐部与确切批次返回数据。"""
        url = urlsplit(flow.request.path)
        if flow.request.method == 'GET':
            return self.joined_read(url)
        return self.put_fixture(flow, self.joined_batch)

    def joined_read(self, url):
        """资料按确切路径匹配，列表另外检查账号查询。"""
        if url.path == '/v10/club':
            return self.joined_list(url.query)
        profiles = {f"/v10/club/{club['id']}/profile": club for club in JOINED_CLUBS}
        return profiles.get(url.path)

    def joined_list(self, query):
        """空账号、重复账号和其他账号不得命中。"""
        if parse_qs(query, keep_blank_values=True).get('user_id') == [self.user_id]:
            return {'clubs': [{'id': identifier} for identifier in JOINED_CLUB_IDENTIFIERS]}
        return None

    def joined_batch(self, path, body):
        """已加入列表场景拒绝非对象正文。"""
        if not isinstance(body, dict):
            return None
        routes = {
            '/v10/clubs': ('club_ids', JOINED_CLUBS),
            '/v2/building/rooms': ('building_ids', []),
        }
        route = routes.get(path)
        if route is not None:
            return self.joined_result(body, *route)
        return None

    def joined_result(self, body, key, result):
        """完整批次匹配后才返回固定结果。"""
        return result if body.get(key) == JOINED_CLUB_IDENTIFIERS else None

    def request(self, flow):
        """控制与业务请求分流，不覆盖已有响应。"""
        if flow.response:
            return
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        self.business_request(flow)

    def business_request(self, flow):
        """场景和 staging 来源通过后才查找夹具。"""
        if not self.active_request(flow):
            return
        result = self.fixture(flow)
        if result is None:
            return
        path = urlsplit(flow.request.path).path
        self.club_room_requests[path] = self.club_room_requests.get(path, 0) + 1
        respond(flow, {'ok': True, 'result': result})

    def active_request(self, flow):
        """只在两个视觉场景和受信 staging 节点生效。"""
        return self.scenario in ('visual-stable', 'club-list-populated') and is_staging(flow.request.host)


addons = [ClubRoomVisualProxy()]
