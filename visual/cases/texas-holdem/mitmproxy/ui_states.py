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
        """校验并设置带入申请阶段和 RPC 错误模式。"""
        if not isinstance(options, dict) or set(options) - {'applications', 'rpcError'}:
            raise ValueError('Invalid UI options')
        if options.get('applications') not in (None, 'pending', 'resolved', 'more') or (
                options.get('rpcError') not in (None, 'retry', 'balance', 'auth')):
            raise ValueError('Invalid UI state')
        self.applications = options.get('applications')
        self.rpc_error = options.get('rpcError')

    def rpc_result(self, frame):
        """为限定的牌局操作或支付 RPC 返回已配置的业务错误。"""
        path = frame['params']['data']['path']
        if not self.rpc_error or not (path.endswith('/call') or path == '/v3/pay_action/do'):
            return None
        if self.rpc_error == 'auth':
            return {'ok': False, 'message': 'Access Token Not Found'}
        kind = 'insufficient_balance' if self.rpc_error == 'balance' else 'visual_network_failure'
        return {'ok': False, 'error': kind,
                'error_description': 'Insufficient balance' if self.rpc_error == 'balance' else 'Please retry'}

    def fixture(self, url, method, content, room_id):
        """仅为当前房间的设置与申请列表接口提供界面状态夹具。"""
        if not room_id:
            return None
        parsed = urlsplit(url)
        path = parsed.path
        settings = f'/v10/texas_holdem/room/{room_id}/user_settings'
        if method == 'PUT' and path in (settings + '/enable_auto_rebuy', settings + '/disable_auto_rebuy'):
            return {'auto_rebuy': path.endswith('/enable_auto_rebuy')}
        if method in ('PUT', 'DELETE') and path == f'/v10/texas_holdem/room/{room_id}/hand_prediction':
            return {}
        if method != 'GET' or path != f'/v11/buy_in/{room_id}/applications' or not self.applications:
            return None
        next_page = parse_qs(parsed.query).get('next_page', [''])[0]
        if next_page not in ('', 'visual-next'):
            return None
        statuses = [None, None] if self.applications != 'resolved' else ['approve', 'reject', 'overdue']
        if next_page:
            statuses = ['approve']
        applications = [
            {'application_id': f'visual-application-{index + (3 if next_page else 0)}',
             'user_id': PLAYER_IDS[index], 'nickname': f'Player{index + 1}',
             'amount': 500 + index * 100, 'room_name': 'TestRoom', 'status': status}
            for index, status in enumerate(statuses)]
        return {'applications': applications,
                'next_page': 'visual-next' if self.applications == 'more' and not next_page else ''}
