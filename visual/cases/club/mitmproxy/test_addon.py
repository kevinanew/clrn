"""用真实 HTTPFlow 核对俱乐部列表及房间代理的业务响应、账号隔离和访问限制。"""

import json
import unittest
from unittest.mock import patch

from mitmproxy import connection, http

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from addon import CLUB_IDENTIFIER, ClubRoomVisualProxy
    from joined_clubs import JOINED_CLUB_IDENTIFIERS
    from test_network_faults import source_environment


def make_flow(path, method='GET', body=None, host='node-0.service.invalid', token=None):
    """建立仅供代理单元测试使用的请求，不访问真实后端。"""
    flow = http.HTTPFlow(
        connection.Client(peername=('127.0.0.1', 12345), sockname=('127.0.0.1', 8080)),
        connection.Server(address=(host, 443)), live=True)
    flow.request = http.Request.make(method, f'https://{host}{path}',
                                     b'' if body is None else json.dumps(body).encode())
    if token:
        flow.request.headers['X-E2E-Control-Token'] = token
    return flow



class ClubRoomVisualProxyTests(unittest.TestCase):
    """逐个验证截图场景必需的三个接口和隔离条件。"""

    def setUp(self):
        self.enterContext(source_environment())
        """每个用例使用独立代理状态。"""
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.proxy = ClubRoomVisualProxy()

    def test_有数据的房间响应保持契约(self):
        """启用固定场景后，俱乐部资料和两条房间使用一致的标识。"""
        control = make_flow('/scenario', 'POST', {'scenario': 'visual-stable'},
                            'test-mitmproxy.invalid', 'test-token')
        self.proxy.request(control)
        self.assertEqual(control.response.status_code, 200, '代理场景应成功启用')

        joined = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(joined)
        joined_result = json.loads(joined.response.content)['result']
        self.assertEqual(joined_result['clubs'], [{'id': CLUB_IDENTIFIER}], '加入的俱乐部标识应固定')

        club = make_flow('/v10/clubs', 'PUT', {'club_ids': [CLUB_IDENTIFIER]})
        self.proxy.request(club)
        club_result = json.loads(club.response.content)['result']
        self.assertEqual(club_result[0]['name'], '演示俱乐部', '俱乐部名称应在卡片中可读')

        rooms = make_flow('/v2/building/rooms', 'PUT', {'building_ids': [CLUB_IDENTIFIER]})
        self.proxy.request(rooms)
        room_result = json.loads(rooms.response.content)['result']
        self.assertEqual(len(room_result), 2, '列表应包含两条固定牌局')
        self.assertEqual([room['seat_occupied'] for room in room_result], [2, 4],
                         '两条牌局应展示不同人数')
        self.assertTrue(all(room['building_id'] == CLUB_IDENTIFIER for room in room_result),
                        '牌局必须属于目标俱乐部')
        self.assertEqual(self.proxy.status()['interceptedRequests'], 3,
                         '三种业务接口都必须由代理提供响应')

    def test_无关请求必须透传(self):
        """未启用场景、其他俱乐部和非 staging 地址不接受固定数据。"""
        before = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(before)
        self.assertIsNone(before.response, '未启用场景时不得替换业务响应')
        self.proxy.scenario = 'visual-stable'

        other_club = make_flow('/v2/building/rooms', 'PUT', {'building_ids': ['other-club']})
        self.proxy.request(other_club)
        self.assertIsNone(other_club.response, '其他俱乐部房间应继续访问真实接口')

        other_host = make_flow('/v10/club?user_id=visual-user', host='node-16.service.invalid')
        self.proxy.request(other_host)
        self.assertIsNone(other_host.response, '非 staging 地址不得收到固定俱乐部')

    def test_控制命令必须认证(self):
        """没有本轮令牌的控制请求不能启用固定场景。"""
        request = make_flow('/scenario', 'POST', {'scenario': 'visual-stable'},
                            'test-mitmproxy.invalid')
        self.proxy.request(request)
        self.assertEqual(request.response.status_code, 403, '无令牌的控制请求必须拒绝')
        self.assertIsNone(self.proxy.scenario, '拒绝后代理仍应保持默认转发状态')

    def enable_joined_clubs(self):
        """为本轮固定账号启用已加入列表场景，并核对控制命令成功。"""
        control = make_flow('/scenario', 'POST', {
            'scenario': 'club-list-populated', 'userId': 'visual-user',
        }, 'test-mitmproxy.invalid', 'test-token')
        self.proxy.request(control)
        self.assertEqual(control.response.status_code, 200, '已加入列表场景应成功启用')

    def test_已加入列表包含三个完整俱乐部(self):
        """列表、批量资料和头像查询使用同一组虚拟俱乐部，房间为空且不访问上游。"""
        self.enable_joined_clubs()
        joined = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(joined)
        self.assertEqual(json.loads(joined.response.content)['result']['clubs'],
                         [{'id': identifier} for identifier in JOINED_CLUB_IDENTIFIERS],
                         '已加入列表应只包含三个固定标识')
        details = make_flow('/v10/clubs', 'PUT', {'club_ids': JOINED_CLUB_IDENTIFIERS})
        self.proxy.request(details)
        clubs = json.loads(details.response.content)['result']
        self.assertEqual([club['name'] for club in clubs], ['星光俱乐部', '周末俱乐部', '好友俱乐部'],
                         '三张卡片应有不同且稳定的名称')
        self.assertEqual([club['member_count'] for club in clubs], [18, 36, 72],
                         '三张卡片应有不同的成员人数')
        for club in clubs:
            profile = make_flow(f"/v10/club/{club['id']}/profile")
            self.proxy.request(profile)
            self.assertEqual(json.loads(profile.response.content)['result'], club,
                             '虚拟头像查询应返回相同资料并保留默认头像')
        rooms = make_flow('/v2/building/rooms', 'PUT', {'building_ids': JOINED_CLUB_IDENTIFIERS})
        self.proxy.request(rooms)
        self.assertEqual(json.loads(rooms.response.content)['result'], [], '本场景不附带牌局')

    def test_已加入列表不得影响其他账号和场景(self):
        """无关账号、混合批次、其他方法、预检和错误正文继续透传，清除场景后停止覆盖。"""
        self.enable_joined_clubs()
        unrelated = [
            make_flow('/v10/club?user_id=other-user'),
            make_flow('/v10/club?user_id=visual-user&user_id=other-user'),
            make_flow('/v10/club?user_id='),
            make_flow('/v10/club?user_id=visual-user', 'POST'),
            make_flow('/v10/club?user_id=visual-user', host='node-16.service.invalid'),
            make_flow('/v10/clubs', 'OPTIONS'),
            make_flow('/v10/clubs', 'PUT', {'club_ids': [*JOINED_CLUB_IDENTIFIERS, 'real-club']}),
            make_flow('/v10/clubs', 'PUT', []),
            make_flow('/v10/club/real-club/profile'),
            make_flow('/v10/club', 'POST', {'name': '不得创建'}),
        ]
        for request in unrelated:
            self.proxy.request(request)
            self.assertIsNone(request.response, '无关请求不得被列表场景覆盖')
        invalid = make_flow('/v10/clubs', 'PUT')
        invalid.request.content = b'{'
        self.proxy.request(invalid)
        self.assertIsNone(invalid.response, '无法解析的正文应透传')
        clear = make_flow('/scenario', 'POST', {'scenario': None},
                          'test-mitmproxy.invalid', 'test-token')
        self.proxy.request(clear)
        after = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(after)
        self.assertIsNone(after.response, '清除后应恢复真实列表请求')
        self.assertIsNone(self.proxy.user_id, '清除后不得保留账号绑定')

    def test_已加入列表必须绑定账号且控制请求需要认证(self):
        """缺少账号和没有控制令牌的请求都不能启用已加入列表场景。"""
        missing = make_flow('/scenario', 'POST', {'scenario': 'club-list-populated'},
                            'test-mitmproxy.invalid', 'test-token')
        self.proxy.request(missing)
        self.assertEqual(missing.response.status_code, 400, '缺少账号时应拒绝启用')
        unauthenticated = make_flow('/scenario', 'POST', {
            'scenario': 'club-list-populated', 'userId': 'visual-user',
        }, 'test-mitmproxy.invalid')
        self.proxy.request(unauthenticated)
        self.assertEqual(unauthenticated.response.status_code, 403, '无控制令牌时应拒绝启用')
        self.assertIsNone(self.proxy.scenario, '拒绝后不得启用场景')
