"""只读采集账户校验的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit
import re


def is_account_path(path):
    """只匹配账户接口，不将用户标识放入诊断。"""
    parts = urlsplit(path).path.split('/')
    return len(parts) == 5 and parts[1:3] == ['v11', 'user'] and parts[4] == 'account'


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


def connection_fields(flow):
    """只为账户和健康探测接口生成固定阶段分类。"""
    if is_account_path(flow.request.path):
        return {'phase': transport_phase(flow.server_conn)}
    return other_connection_fields(flow)


def other_connection_fields(flow):
    """对房间和健康探测接口标记各自阶段。"""
    if is_room_path(flow.request.path):
        return {'phase': transport_phase(flow.server_conn).replace('account-', 'room-', 1)}
    if urlsplit(flow.request.path).path == '/node/v1/status':
        return {'phase': transport_phase(flow.server_conn).replace('account-', 'probe-', 1)}
    return {}


def account_connection_fields(flow):
    """采集异常只产生固定标记，不影响原请求或泄露异常正文。"""
    try:
        return connection_fields(flow)
    except Exception:
        return {'phase': 'account-connection-unavailable'}


class RoomConnections:
    """复用已有分支的连接关联诊断，仅观察建房价格和钱包的真实连接。"""
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
    """仅匹配本轮失败的建房接口，忽略查询参数。"""
    path = urlsplit(value).path
    parts = path.split('/')
    return any((path in ('/v3/pay_action/batch/price', '/v1/game_log/room/game_amount'),
                len(parts) == 4 and parts[1:3] == ['v10', 'wallet'],
                bool(re.fullmatch(r'/v10/texas_holdem/room/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/user_settings', path))))


def connection_reason(connection):
    """只输出固定错误分类，不输出上游错误正文。"""
    return 'connection-error' if connection.error else 'none'


class AccountConnections(RoomConnections):
    """关联账户请求的客户端与真实连接钩子，避免把 flow 占位连接当作 TCP 状态。"""
    def observe(self, flow):
        """只读登记账户请求目标；任何诊断错误都不影响请求。"""
        try:
            if is_account_path(flow.request.path):
                self.remember(flow)
        except Exception:
            pass

    def fields(self, data, node_name):
        """只输出账户连接的匿名关联和实际 TCP/TLS 时间戳状态。"""
        try:
            target = self.targets.get(str(data.client.id))
            if target != data.server.address:
                return None
            connection = data.server
            return {'source': 'account-transport', 'operation': 'account-connect',
                    'node': node_name(target[0]), 'connectionId': str(data.client.id),
                    'upstreamConnectionId': str(connection.id),
                    'phase': transport_phase(connection).replace('account-', 'account-hook-', 1),
                    'reason': connection_reason(connection)}
        except Exception:
            return None


def room_error_fields(flow):
    """区分本轮建房读取的请求接收、响应头及响应体阶段，异常不影响原错误。"""
    try:
        if not is_room_path(flow.request.path):
            return {}
        return {
            'requestBodyReceived': flow.request.timestamp_end is not None,
            'responseHeadersReceived': flow.response is not None,
            'responseBodyReceived': response_body_received(flow.response),
            'clientHttpVersion': known_http_version(flow.request.http_version),
            'upstreamAlpn': {b'h2': 'h2', b'http/1.1': 'http/1.1'}.get(flow.server_conn.alpn, 'unknown'),
        }
    except Exception:
        return {}


def known_http_version(value):
    """只输出协议白名单，不保存任意请求行内容。"""
    return value if value in ('HTTP/1.0', 'HTTP/1.1', 'HTTP/2', 'HTTP/3') else 'unknown'


def response_body_received(response):
    """仅在响应存在且正文完成时标记接收完成。"""
    return response is not None and response.timestamp_end is not None
