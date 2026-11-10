"""只读采集账户、牌桌及本轮失败读取的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit


def connection_scope(path):
    """仅登记账户、牌桌选线、订阅及本轮失败的读取接口；不保存实体标识。"""
    parts = urlsplit(path).path.split('/')
    if len(parts) == 5 and parts[1:3] == ['v11', 'user'] and parts[4] == 'account':
        return 'account'
    if urlsplit(path).path in ('/node/v1/status', '/public/v12/metadata/servers',
                              '/public/v13/metadata/servers', '/v2/centrifugo/connection/websocket'):
        return 'table'
    if urlsplit(path).path in ('/v3/pay_action/batch/price',) or (
            len(parts) == 4 and parts[1:3] == ['v10', 'wallet']):
        return 'renewal'
    if len(parts) == 6 and parts[1:4] == ['v10', 'texas_holdem', 'room'] and parts[5] == 'profile':
        return 'table'
    if len(parts) == 6 and parts[1:4] == ['v1', 'game_log', 'room'] and parts[5] == 'settlement':
        return 'settlement'
    if len(parts) == 6 and parts[1:3] == ['v11', 'game_log'] and parts[4] == 'play_session_record':
        return 'record'
    return None


def account_connection_fields(flow):
    """区分尚未建连、TCP/TLS 等待和响应等待；采集异常不影响原请求。"""
    try:
        scope = connection_scope(flow.request.path)
        if scope is None:
            return {}
        connection = flow.server_conn
        if connection.timestamp_start is None:
            phase = 'account-connect-not-started'
        elif connection.timestamp_tcp_setup is None:
            phase = 'account-tcp-pending'
        elif connection.tls and connection.timestamp_tls_setup is None:
            phase = 'account-tls-pending'
        else:
            phase = 'account-transport-ready'
        return {'phase': phase.replace('account-', scope + '-', 1)}
    except Exception:
        return {'phase': 'account-connection-unavailable'}


class AccountConnections:
    """关联失败接口的客户端与真实连接钩子，避免把 flow 占位连接当作 TCP 状态。"""
    def __init__(self):
        """仅保留有界关联，不保存认证头、用户路径或异常正文。"""
        self.targets = {}

    def observe(self, flow):
        """只读登记白名单接口目标；任何诊断错误都不影响请求。"""
        try:
            scope = connection_scope(flow.request.path)
            if scope is None:
                return
            if len(self.targets) >= 1000:
                self.targets.pop(next(iter(self.targets)))
            self.targets[str(flow.client_conn.id)] = (flow.request.host, flow.request.port, scope)
        except Exception:
            pass

    def fields(self, data, node_name):
        """只输出白名单连接的匿名关联和实际 TCP/TLS 时间戳状态。"""
        try:
            target = self.targets.get(str(data.client.id))
            if target is None or target[:2] != data.server.address:
                return None
            connection = data.server
            phase = ('not-started' if connection.timestamp_start is None else
                     'tcp-pending' if connection.timestamp_tcp_setup is None else
                     'tls-pending' if connection.tls and connection.timestamp_tls_setup is None else
                     'transport-ready')
            return {'source': target[2] + '-transport', 'operation': target[2] + '-connect',
                    'node': node_name(target[0]), 'connectionId': str(data.client.id),
                    'upstreamConnectionId': str(connection.id),
                    'phase': target[2] + '-hook-' + phase,
                    'reason': 'connection-error' if connection.error else 'none'}
        except Exception:
            return None
