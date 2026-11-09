"""本轮回放房间的视觉分支夹具，不改真实玩家、申请或钱包。"""

from urllib.parse import urlsplit, parse_qs
from texas_replay import PLAYER_IDS


class UIStates:
    """管理德州申请列表、用户设置与 RPC 错误展示状态。"""
    def __init__(self):
        """初始化界面或缓存状态，确保首次使用从默认配置开始。"""
        self.release()

    def release(self):
        """清除带入申请和 RPC 错误配置，恢复默认透传。"""
        self.applications = None
        self.rpc_error = None

    def configure(self, options):
        """先完整校验，再一次性更新界面状态。"""
        if not isinstance(options, dict) or set(options) - {'applications', 'rpcError'}:
            raise ValueError('Invalid UI options')
        self.validate_states(options)
        self.applications = options.get('applications')
        self.rpc_error = options.get('rpcError')

    def validate_states(self, options):
        """保持申请和 RPC 错误各自的合法枚举。"""
        if options.get('applications') not in (None, 'pending', 'resolved', 'more'):
            raise ValueError('Invalid UI state')
        if options.get('rpcError') not in (None, 'retry', 'balance', 'auth'):
            raise ValueError('Invalid UI state')

    def rpc_result(self, frame):
        """只有已配置错误的 call 或支付 RPC 返回业务错误。"""
        path = frame['params']['data']['path']
        if self.rpc_error and self.error_path(path):
            return self.error_result()
        return None

    def error_path(self, path):
        """固定错误入口不扩大到其他房间请求。"""
        return path.endswith('/call') or path == '/v3/pay_action/do'

    def error_result(self):
        """使用固定表保持错误类型和说明一致。"""
        errors = {
            'auth': {'ok': False, 'message': 'Access Token Not Found'},
            'balance': {'ok': False, 'error': 'insufficient_balance', 'error_description': 'Insufficient balance'},
            'retry': {'ok': False, 'error': 'visual_network_failure', 'error_description': 'Please retry'},
        }
        return errors.get(self.rpc_error, errors['retry'])

    def fixture(self, url, method, content, room_id):
        """当前房间绑定之后才读取设置和申请夹具。"""
        if not room_id:
            return None
        parsed = urlsplit(url)
        result = self.settings_fixture(parsed.path, method, room_id)
        if result is not None:
            return result
        return self.application_fixture(parsed, method, room_id)

    def settings_fixture(self, path, method, room_id):
        """设置与预测只匹配原有写入路径。"""
        settings = f'/v10/texas_holdem/room/{room_id}/user_settings'
        routes = {
            ('PUT', settings + '/enable_auto_rebuy'): {'auto_rebuy': True},
            ('PUT', settings + '/disable_auto_rebuy'): {'auto_rebuy': False},
            ('PUT', f'/v10/texas_holdem/room/{room_id}/hand_prediction'): {},
            ('DELETE', f'/v10/texas_holdem/room/{room_id}/hand_prediction'): {},
        }
        return routes.get((method, path))

    def application_fixture(self, parsed, method, room_id):
        """申请列表只允许当前房间的 GET。"""
        if (method, parsed.path) != ('GET', f'/v11/buy_in/{room_id}/applications'):
            return None
        if self.applications:
            return self.application_page(parse_qs(parsed.query).get('next_page', [''])[0])
        return None

    def application_page(self, next_page):
        """保留固定游标、分页条目和状态。"""
        if next_page not in ('', 'visual-next'):
            return None
        statuses = self.application_statuses(next_page)
        applications = [self.application(index, status, next_page) for index, status in enumerate(statuses)]
        return {'applications': applications, 'next_page': self.next_page(next_page)}

    def application_statuses(self, next_page):
        """续页与已处理列表使用原有固定状态。"""
        if next_page:
            return ['approve']
        return [None, None] if self.applications != 'resolved' else ['approve', 'reject', 'overdue']

    def application(self, index, status, next_page):
        """创建单条固定申请，不改变玩家、金额或编号。"""
        return {'application_id': f'visual-application-{index + (3 if next_page else 0)}',
                'user_id': PLAYER_IDS[index], 'nickname': f'Player{index + 1}',
                'amount': 500 + index * 100, 'room_name': 'TestRoom', 'status': status}

    def next_page(self, next_page):
        """只有 more 模式首屏暴露续页。"""
        return 'visual-next' if self.applications == 'more' and not next_page else ''
