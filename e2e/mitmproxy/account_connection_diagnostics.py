"""只读采集账户校验的连接阶段，不记录连接地址、错误正文或认证资料。"""

from urllib.parse import urlsplit


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
    return path == '/v3/pay_action/batch/price' or all((
        len(parts) == 4, parts[1:3] == ['v10', 'wallet']))


def connection_reason(connection):
    """只输出固定错误分类，不输出上游错误正文。"""
    return 'connection-error' if connection.error else 'none'
