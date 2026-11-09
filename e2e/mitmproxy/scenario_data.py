"""共用场景常量、数据读取与响应封装。"""

import json
import re
from pathlib import Path
from mitmproxy import http

CONTROL_HOST = 'fixtures-mitmproxy.invalid'
DATA = Path(__file__).with_name('data')
MATCHING_PATHS = {f'/v1/hall_matching/{action}' for action in ('join', 'quit', 'keep_waiting')}
PAYMENT_ORDER = re.compile(r'/v\d+/(?:alipay_order/order|virtual_payment/order|telegram_payment/user/[^/]+/order)')
SCENES = {'none', 'daily-bonus', 'club-empty', 'wallet-empty', 'wallet-populated', 'mall',
          'invitation', 'matching', 'slot', 'club-skeleton', 'launch', 'pagination',
          'club-error', 'hall-error', 'auto-rebuy'}
PHASES = {name: {'ready'} for name in SCENES}
for name in ('launch', 'club-skeleton', 'auto-rebuy'):
    PHASES[name] |= {'hold', 'release'}
for name in ('club-error', 'hall-error'):
    PHASES[name].add('release')
PHASES['slot'] |= {'coin', 'currency_diamond', 'energy', 'exhausted'}


def data(name):
    """读取指定名称的共用场景 JSON 数据。"""
    return json.loads((DATA / f'{name}.json').read_text())


def respond(flow, body, status=200):
    """向代理流写入 JSON 响应及必要跨域头。"""
    flow.response = http.Response.make(status, json.dumps(body).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
    })


def result(flow, body):
    """将夹具内容包装成成功业务结果并发送。"""
    respond(flow, {'ok': True, 'result': body})


def clubs():
    """构造用于列表交互验证的固定俱乐部资料。"""
    return [{'id': f'00000000-0000-4000-8000-00000000010{i}', 'club_no': 100 + i,
             'name': f'TestClub{i}', 'owner_id': 'visual-owner', 'member_count': 5,
             'created_at': '2026-01-01T00:00:00Z', 'admin_ids': [], 'game_type': 'texas_holdem'}
            for i in (1, 2)]


def applications(start, count):
    """从指定偏移生成固定数量的带入申请记录。"""
    return [{'application_id': f'interaction-{i}', 'status': 'approve', 'amount': 100,
             'user_id': 'interaction-player', 'created_at': '2026-09-01T00:00:00Z',
             'auditor_id': 'interaction-auditor', 'nickname': f'滚动玩家{i}',
             'building_name': '交互测试', 'room_name': '分页牌局'} for i in range(start, start + count)]

