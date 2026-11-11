"""只读采集账户、牌桌及本轮失败读取的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit
import re


def connection_scope(path):
    """仅登记账户、牌桌选线、订阅及本轮失败的读取接口；不保存实体标识。"""
    parts = urlsplit(path).path.split('/')
    if len(parts) == 5 and parts[1:3] == ['v11', 'user'] and parts[4] == 'account':
        return 'account'
    if urlsplit(path).path in ('/v2/check_in/seven_day/rule', '/v2/check_in/seven_day/current'):
        return 'check-in'
    if len(parts) == 5 and parts[1:4] == ['v10', 'house', 'user']:
        return 'house'
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
            return {'phase': transport_phase(flow.server_conn).replace('account-', 'room-', 1)} if is_room_path(flow.request.path) else {}
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
    """观察建房价格、德州用户设置及战绩数量的真实连接。"""
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
    """限定已发生失败的房间接口，忽略查询参数且不输出房间 ID。"""
    path = urlsplit(value).path
    return path in ('/v3/pay_action/batch/price', '/v1/game_log/room/game_amount') or bool(re.fullmatch(
        r'/v10/texas_holdem/room/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/user_settings', path))


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
            'responseBodyReceived': flow.response is not None and flow.response.timestamp_end is not None,
            'clientHttpVersion': known_http_version(flow.request.http_version),
            'upstreamAlpn': {b'h2': 'h2', b'http/1.1': 'http/1.1'}.get(flow.server_conn.alpn, 'unknown'),
        }
    except Exception:
        return {}


def known_http_version(value):
    """只输出协议白名单，不保存任意请求行内容。"""
    return value if value in ('HTTP/1.0', 'HTTP/1.1', 'HTTP/2', 'HTTP/3') else 'unknown'
