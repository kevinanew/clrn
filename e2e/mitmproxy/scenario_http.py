"""按具名场景处理 HTTP 读取，保留上游透传和写入隔离。"""

import os
import re
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
from mitmproxy import http
from response_overrides import is_staging
from scenario_data import CONTROL_HOST, MATCHING_PATHS, PAYMENT_ORDER, applications, clubs, data, respond, result


def valid_feedback_origin(target):
    """反馈来源只接受无凭据、无查询和片段的 HTTPS 根路径。"""
    return all((target.scheme == 'https', target.hostname is not None,
                not target.username, not target.password, target.path in ('', '/'),
                not target.query, not target.fragment))


def json_body(flow):
    """损坏请求正文只导致本场景不命中。"""
    try:
        return flow.request.json()
    except ValueError:
        return None


def slot_path(path):
    """只接受老虎机能量及旋转接口。"""
    return re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)', path)


def kill(flow):
    """只关闭代理允许终止的流。"""
    if flow.killable:
        flow.kill()


class ScenarioHttp:
    """组合环境处理和场景专用路由。"""

    def is_feedback(self, flow):
        """反馈页面来源由运行输入提供，协议、主机和端口必须全部匹配。"""
        try:
            target = urlsplit(os.environ.get('MITMPROXY_FEEDBACK_ORIGIN', ''))
            return self.feedback_matches(flow, target)
        except ValueError:
            return False

    def feedback_matches(self, flow, target):
        """先验证配置，再核对请求来源。"""
        if not valid_feedback_origin(target):
            return False
        return (flow.request.scheme, flow.request.host, flow.request.port) == (
            target.scheme, target.hostname, target.port or 443)

    def blocks_payment(self, path, method):
        """视觉环境和商城场景不得发出真实订单写入。"""
        if not any((self.visual, self.name == 'mall')):
            return False
        return self.payment_path(path, method)

    def payment_path(self, path, method):
        """限制写入方法并验证订单接口。"""
        if not isinstance(path, str):
            return False
        return method in ('POST', 'PUT', 'PATCH', 'DELETE') and PAYMENT_ORDER.fullmatch(path)

    def blocked_write_error(self, path, method):
        """统一返回 HTTP 夹具禁止真实写入时的错误码。"""
        if self.blocks_payment(path, method):
            return 'fixture_payment_forbidden'
        return self.registration_error(path)

    def registration_error(self, path):
        """视觉环境隔离注册接口。"""
        if self.visual and re.fullmatch(r'/public/v\d+/user/register/.*', path):
            return 'fixture_registration_forbidden'
        return None

    def own_club_list(self, flow, path):
        """俱乐部列表只命中唯一所属账号的 GET 请求。"""
        if not self.user_id:
            return False
        return all((flow.request.method == 'GET', path == '/v10/club',
                    parse_qs(urlsplit(flow.request.path).query, keep_blank_values=True)
                    .get('user_id') == [self.user_id]))

    def environment_request(self, flow):
        """显式视觉环境中隔离聊天并稳定反馈页面。"""
        if not self.visual:
            return False
        if self.chat_request(flow):
            kill(flow)
            return True
        return self.feedback_request(flow)

    def chat_request(self, flow):
        """仅识别 Freshchat 本身及子域。"""
        return flow.request.host == 'freshchat.com' or flow.request.host.endswith('.freshchat.com')

    def feedback_request(self, flow):
        """反馈页面仅替换 GET 请求，保留其他传输。"""
        if self.is_feedback(flow) and flow.request.method == 'GET':
            flow.response = http.Response.make(200,
                b'<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
                b'<body style="margin:0;background:#f5f5f5"></body></html>',
                {'Content-Type': 'text/html; charset=utf-8'})
            return True
        return False

    async def request(self, flow):
        """优先处理控制及环境请求，再处理允许的业务场景。"""
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        if self.skip_request(flow):
            return
        await self.business_request(flow)

    def skip_request(self, flow):
        """已有响应优先保留；环境请求先于业务来源过滤。"""
        if flow.response:
            return True
        return self.environment_request(flow)

    async def business_request(self, flow):
        """业务读取只处理配置来源，预检始终透传。"""
        if not is_staging(flow.request.host) or flow.request.method == 'OPTIONS':
            return
        await self.fixture_request(flow, urlsplit(flow.request.path).path)

    async def fixture_request(self, flow, path):
        """写入隔离先于国家资料和具体场景分发。"""
        if error := self.blocked_write_error(path, flow.request.method):
            respond(flow, {'ok': False, 'error': error}, 403)
            return
        if self.country_request(flow, path):
            return
        await self.scene_request(flow, path)

    def country_request(self, flow, path):
        """仅稳定视觉环境的国家资料 GET。"""
        if all((self.visual, flow.request.method == 'GET', path == '/public/v10/profile/country')):
            respond(flow, data('country'))
            return True
        return False

    async def scene_request(self, flow, path):
        """按具名场景选择处理器，无场景时透传。"""
        handler = {'launch': self.launch_request, 'slot': self.slot_request,
                   'matching': self.matching_request, 'club-empty': self.club_empty_request,
                   'mall': self.mall_request, 'wallet-empty': self.wallet_request,
                   'wallet-populated': self.wallet_request, 'daily-bonus': self.bonus_request,
                   'invitation': self.invitation_request, 'club-skeleton': self.skeleton_request,
                   'pagination': self.pagination_request, 'club-error': self.failure_request,
                   'hall-error': self.failure_request, 'auto-rebuy': self.rebuy_request}.get(self.name)
        if handler:
            await handler(flow, path)

    async def launch_request(self, flow, path):
        """启动闸门只挂起健康读取，不伪造响应。"""
        if path == '/node/v1/status' and flow.request.method == 'GET':
            await self.wait()

    async def slot_request(self, flow, path):
        """老虎机场景按接口返回当前归属的结果。"""
        if slot_path(path):
            respond(flow, self.slot_reply(path))

    async def matching_request(self, flow, path):
        """隔离匹配加入、退出及等待写入。"""
        if path in MATCHING_PATHS and flow.request.method == 'POST':
            self.requests += 1
            result(flow, {})

    async def club_empty_request(self, flow, path):
        """仅所属账号列表返回空态。"""
        if self.own_club_list(flow, path):
            result(flow, {'clubs': []})

    async def mall_request(self, flow, path):
        """商城只覆盖只读商品接口。"""
        if flow.request.method == 'GET' and re.fullmatch(r'/v\d+/alipay_order/goods', path):
            respond(flow, data('goods'))

    async def wallet_request(self, flow, path):
        """账单只覆盖所属账号的两种币种读取。"""
        if not self.user_id:
            return
        if self.wallet_path(flow, path):
            currency = path.split('/')[-2]
            statements = self.wallet_statements(currency)
            self.observed.append(f'wallet:{currency}')
            result(flow, {'currency_name': currency, 'statements': statements})

    def wallet_path(self, flow, path):
        """精确限制钱包账号、币种和读取方法。"""
        return flow.request.method == 'GET' and re.fullmatch(
            rf'/v11/wallet/{re.escape(self.user_id)}/currency/(coin|diamond)/statement', path)

    async def bonus_request(self, flow, path):
        """每日奖励只稳定规则和当日领取状态。"""
        if flow.request.method != 'GET':
            return
        self.bonus_reply(flow, path)

    async def invitation_request(self, flow, path):
        """邀请只替换所属房屋的确切只读批次。"""
        if not all((flow.request.method == 'PUT', path == '/v2/building/rooms', self.house_id)):
            return
        requested = json_body(flow)
        if self.invitation_batch(requested):
            rooms = data('invitation')
            rooms['result'][0].update(building_id=self.house_id, creator_id=self.user_id)
            respond(flow, rooms)

    def invitation_batch(self, requested):
        """仅接受所属房屋的单项查询。"""
        return isinstance(requested, dict) and requested.get('building_ids') == [self.house_id]

    async def skeleton_request(self, flow, path):
        """列表立即返回虚拟编号，详情使用原有闸门。"""
        if self.own_club_list(flow, path):
            result(flow, {'clubs': self.club_identifiers()})
        elif (flow.request.method, path) == ('PUT', '/v10/clubs'):
            await self.skeleton_details(flow)

    def club_identifiers(self):
        """骨架列表只返回固定虚拟俱乐部编号。"""
        return [{'id': club['id']} for club in clubs()]

    async def skeleton_details(self, flow):
        """仅确切虚拟俱乐部批次被挂起并替换。"""
        if json_body(flow) == {'club_ids': [club['id'] for club in clubs()]}:
            self.requests += 1
            await self.wait()
            result(flow, clubs())

    async def pagination_request(self, flow, path):
        """分页只匹配所属审核账号的申请读取。"""
        if not self.user_id:
            return
        if self.pagination_path(flow, path):
            self.pagination_reply(flow, path)

    def pagination_path(self, flow, path):
        """固定分页账号和处理状态。"""
        return flow.request.method == 'GET' and re.fullmatch(
            rf'/v10/buy_in/auditor/{re.escape(self.user_id)}/applications/(pending|processed)', path)

    def pagination_reply(self, flow, path):
        """待处理为空，已处理严格验证下一页游标。"""
        cursor = parse_qs(urlsplit(flow.request.path).query).get('next_page', [None])[0]
        if path.endswith('/pending'):
            result(flow, {'applications': [], 'next_page': None})
        elif cursor not in (None, 'interaction-page-2'):
            respond(flow, {'error': 'Unknown cursor'}, 400)
        else:
            self.processed_page(flow, cursor)

    def processed_page(self, flow, cursor):
        """保留两页数据、游标顺序和末页行为。"""
        self.cursors.append(cursor)
        result(flow, {'applications': applications(13, 3) if cursor else applications(1, 12),
                      'next_page': None if cursor else 'interaction-page-2'})

    def failure_target(self, flow, path):
        """俱乐部故障要求查询账号，首页故障仅匹配公开列表。"""
        if self.name == 'club-error':
            return path == '/v10/club' and 'user_id' in parse_qs(urlsplit(flow.request.path).query)
        return path == '/public/v1/hall_matching/available.json'

    async def failure_request(self, flow, path):
        """故障释放后继续真实上游读取。"""
        if flow.request.method != 'GET':
            return
        if self.failure_target(flow, path):
            self.record_failure(flow)

    def record_failure(self, flow):
        """记录命中次数，仅未释放阶段终止请求。"""
        self.requests += 1
        if self.phase != 'release':
            kill(flow)

    async def rebuy_request(self, flow, path):
        """仅隔离已观察房间的自动补充设置。"""
        paths = (f'/v10/texas_holdem/room/{self.room_id}/user_settings/enable_auto_rebuy',
                 f'/v10/texas_holdem/room/{self.room_id}/user_settings/disable_auto_rebuy')
        if flow.request.method == 'PUT' and path in paths:
            self.requests += 1
            await self.wait()
            result(flow, {'auto_rebuy': path.endswith('/enable_auto_rebuy')})


    def wallet_statements(self, currency):
        """只有非空钱包场景加载固定流水。"""
        return data('wallet-statements')[currency] if self.name == 'wallet-populated' else []

    def bonus_reply(self, flow, path):
        """按具名只读奖励接口构造结果。"""
        if path == '/v2/check_in/seven_day/rule':
            respond(flow, data('check-in-rule'))
        elif path == '/v2/check_in/seven_day/current':
            result(flow, [{'check_in_at': datetime.now(timezone.utc).isoformat()}])
