"""只读采集账户校验的连接阶段，不记录连接地址、错误正文或认证资料。"""

import re
from urllib.parse import urlsplit


def account_connection_fields(flow):
    """区分尚未建连、TCP/TLS 等待和响应等待；采集异常不影响原请求。"""
    try:
        if is_room_path(flow.request.path):
            return {'phase': transport_phase(flow.server_conn).replace('account-', 'room-', 1)}
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
            if is_room_path(flow.request.path) or not account_connection_fields(flow):
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


def transport_phase(connection):
    """通过已有时间戳区分尚未建连和 TCP 等待。"""
    if connection.timestamp_start is None:
        return 'account-connect-not-started'
    if connection.timestamp_tcp_setup is None:
        return 'account-tcp-pending'
    return tls_phase(connection)


def tls_phase(connection):
    """TCP 完成后区分 TLS 等待和传输就绪。"""
    if connection.tls and connection.timestamp_tls_setup is None:
        return 'account-tls-pending'
    return 'account-transport-ready'



class RoomConnections:
    """复用已有分支的连接关联诊断，观察建房价格和房间详情的真实连接。"""
    def __init__(self):
        """有界保存客户端与目标的关联，输出不包含地址。"""
        self.targets = {}

    def observe(self, flow):
        """只登记本轮超时接口，诊断异常不影响请求。"""
        try:
            if is_room_path(flow.request.path):
                self.remember(flow)
        except Exception:
            pass

    def remember(self, flow):
        """沿用已有分支的有界关联表。"""
        if len(self.targets) >= 1000:
            self.targets.pop(next(iter(self.targets)))
        self.targets[str(flow.client_conn.id)] = (flow.request.host, flow.request.port)

    def fields(self, data, node_name):
        """读取真实连接钩子，避免将 flow 占位连接误判为尚未建立 TCP。"""
        try:
            target = self.targets.get(str(data.client.id))
            if target != data.server.address:
                return None
            return {'source': 'room-transport', 'operation': 'room-connect',
                    'node': node_name(target[0]), 'connectionId': str(data.client.id),
                    'upstreamConnectionId': str(data.server.id),
                    'phase': transport_phase(data.server).replace('account-', 'room-hook-', 1),
                    'reason': connection_reason(data.server)}
        except Exception:
            return None


def is_room_path(value):
    """仅匹配建房及私人房列表依赖，忽略查询参数。"""
    path = urlsplit(value).path
    return path in ('/v3/pay_action/batch/price', '/v2/building/rooms') or bool(re.fullmatch(
        r'/v10/(?:profile|house/user)/[^/]+', path)) or bool(re.fullmatch(
        r'/v1/room/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', path))


def connection_reason(connection):
    """只输出固定错误分类，不输出上游错误正文。"""
    return 'connection-error' if connection.error else 'none'
