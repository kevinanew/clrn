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
