"""真实上游响应中的归属观测和最小钱包展示修改。"""

import re
from urllib.parse import urlsplit
from response_overrides import is_staging, patch_result, successful_response


def house_response(flow, path, value):
    """房屋归属只来自真实资料读取。"""
    return all((flow.request.method in ('GET', 'PUT'),
                re.fullmatch(r'/v10/house/user/[^/]+', path), isinstance(value, dict)))


def creation_response(flow, path, value, room_id):
    """仅首次真实成功建房结果用于绑定房间。"""
    return all((flow.request.method == 'POST', path == '/v3/pay_action/do',
                isinstance(value, dict), not room_id))


def creation_action(request):
    """解析实际支付动作及建房配置。"""
    action, config = request.get('action_url'), request.get('action_json')
    if not all((isinstance(action, dict), isinstance(config, dict))):
        return False
    return all((action.get('method') == 'POST',
                action.get('path') in ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room'),
                config.get('game_type') in ('texas_holdem', 'texas_react_native')))


def created_room(value):
    """房间编号必须是非空字符串。"""
    return isinstance(value.get('room_id'), str) and bool(value['room_id'])


def change_coin(currency):
    """仅覆盖金币展示余额。"""
    if currency.get('code') == 'coin':
        currency['balance'] = '1000'


def change_wallet(wallet):
    """结构变化时让公共修改器保留原始响应。"""
    currencies = wallet.get('currencies')
    if not isinstance(currencies, list):
        raise ValueError('Missing currencies')
    for currency in currencies:
        change_coin(currency)
    return True


class ScenarioResponse:
    """从限定真实响应绑定归属，按场景稳定必要展示字段。"""

    def response(self, flow):
        """只处理配置来源的 HTTP 200 响应。"""
        if not is_staging(flow.request.host) or not successful_response(flow):
            return
        self.observe_response(flow)

    def observe_response(self, flow):
        """无效信封或错误结构透传，保留原始错误传播边界。"""
        path = urlsplit(flow.request.path).path
        try:
            body = flow.response.json()
            if body.get('ok') is not True:
                return
            self.observe_owner(flow, path, body.get('result'))
        except (ValueError, TypeError, AttributeError):
            return
        self.patch_wallet(flow, path)

    def observe_owner(self, flow, path, value):
        """分别处理房屋归属及真实建房响应。"""
        if house_response(flow, path, value):
            self.observe_house(path, value)
        if creation_response(flow, path, value, self.room_id):
            self.observe_creation(flow.request.json(), value)

    def observe_house(self, path, value):
        """代理首次认领账号后不接受其他账号的房屋资料。"""
        owner = path.rsplit('/', 1)[-1]
        if not self.user_id or self.user_id == owner:
            self.user_id = owner
            self.house_id = value.get('house_id', '')

    def observe_creation(self, request, value):
        """要求建房动作、游戏、账号及房间编号全部匹配。"""
        if not creation_action(request):
            return
        if all((request.get('user_id') == self.user_id, created_room(value))):
            self.room_id = value['room_id']

    def patch_wallet(self, flow, path):
        """每日奖励只修改所属账号钱包的 PUT 响应。"""
        if all((self.name == 'daily-bonus', self.user_id, flow.request.method == 'PUT',
                path == f'/v10/wallet/{self.user_id}')):
            patch_result(flow, change_wallet)
