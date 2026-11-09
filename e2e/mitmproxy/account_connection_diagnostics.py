"""只读采集账户校验的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit


def account_connection_fields(flow):
    """区分尚未建连、TCP/TLS 等待和响应等待；采集异常不影响原请求。"""
    try:
        parts = urlsplit(flow.request.path).path.split('/')
        if len(parts) != 5 or parts[1:3] != ['v11', 'user'] or parts[4] != 'account':
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
        return {'phase': phase}
    except Exception:
        return {'phase': 'account-connection-unavailable'}


class AccountConnections:
    """关联账户请求的客户端与真实连接钩子，避免把 flow 占位连接当作 TCP 状态。"""
    def __init__(self):
        """仅保留有界关联，不保存认证头、用户路径或异常正文。"""
        self.targets = {}

    def observe(self, flow):
        """只读登记账户请求目标；任何诊断错误都不影响请求。"""
        try:
            if not account_connection_fields(flow):
                return
            if len(self.targets) >= 1000:
                self.targets.pop(next(iter(self.targets)))
            self.targets[str(flow.client_conn.id)] = (flow.request.host, flow.request.port)
        except Exception:
            pass

    def fields(self, data, node_name):
        """只输出账户连接的匿名关联和实际 TCP/TLS 时间戳状态。"""
        try:
            target = self.targets.get(str(data.client.id))
            if target is None or target != data.server.address:
                return None
            connection = data.server
            phase = ('not-started' if connection.timestamp_start is None else
                     'tcp-pending' if connection.timestamp_tcp_setup is None else
                     'tls-pending' if connection.tls and connection.timestamp_tls_setup is None else
                     'transport-ready')
            return {'source': 'account-transport', 'operation': 'account-connect',
                    'node': node_name(target[0]), 'connectionId': str(data.client.id),
                    'upstreamConnectionId': str(connection.id),
                    'phase': 'account-hook-' + phase,
                    'reason': 'connection-error' if connection.error else 'none'}
        except Exception:
            return None
