"""只读采集账户校验和牌桌选线的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit
import re


def connection_scope(path):
    """仅登记账户、牌桌选线和订阅接口；不保存实体标识。"""
    if is_account_path(path):
        return 'account'
    if urlsplit(path).path in ('/node/v1/status', '/public/v12/metadata/servers',
                              '/public/v13/metadata/servers', '/v2/centrifugo/connection/websocket'):
        return 'table'
    return None


def is_account_path(path):
    """只匹配账户接口。"""
    parts = urlsplit(path).path.split('/')
    return len(parts) == 5 and parts[1:3] == ['v11', 'user'] and parts[4] == 'account'


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
            self.remember(flow, scope)
        except Exception:
            pass

    def remember(self, flow, scope):
        """有界保存目标与诊断范围。"""
        if len(self.targets) >= 1000:
            self.targets.pop(next(iter(self.targets)))
        self.targets[str(flow.client_conn.id)] = (flow.request.host, flow.request.port, scope)

    def fields(self, data, node_name):
        """只输出白名单连接的匿名关联和实际 TCP/TLS 时间戳状态。"""
        try:
            target = self.targets.get(str(data.client.id))
            if not matches_target(target, data.server.address):
                return None
            connection = data.server
            phase = transport_phase(connection).replace('account-', target[2] + '-hook-', 1)
            return {'source': target[2] + '-transport', 'operation': target[2] + '-connect',
                    'node': node_name(target[0]), 'connectionId': str(data.client.id),
                    'upstreamConnectionId': str(connection.id),
                    'phase': phase,
                    'reason': connection_reason(connection)}
        except Exception:
            return None


def matches_target(target, address):
    """只关联与登记目标一致的连接。"""
    return target is not None and target[:2] == address


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
    if connection_scope(flow.request.path) == 'account':
        return {'phase': transport_phase(flow.server_conn)}
    return other_connection_fields(flow)


def other_connection_fields(flow):
    """对房间和健康探测接口标记各自阶段。"""
    if is_room_path(flow.request.path):
        return {'phase': transport_phase(flow.server_conn).replace('account-', 'room-', 1)}
    if connection_scope(flow.request.path) == 'table':
        return {'phase': transport_phase(flow.server_conn).replace('account-', 'table-', 1)}
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
