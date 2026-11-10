"""发布服务的请求来源、真实连接和安全错误分类。"""

import os
import re
from urllib.parse import urlsplit


def valid_release_origin(expected):
    """发布服务必须是带端口且无凭据的本机 HTTP 来源。"""
    return all((expected.scheme == 'http', expected.hostname == '127.0.0.1',
                not expected.username, not expected.password, bool(expected.port)))


def release_origin_match(flow):
    """仅比较请求 URL，不代表实际套接字来源。"""
    configured = os.environ.get('CLRN_RELEASE_WEB_URL')
    if not configured:
        return 'unconfigured'
    return configured_origin_match(flow, configured)


def configured_origin_match(flow, configured):
    """损坏配置产生独立诊断状态。"""
    try:
        expected = urlsplit(configured)
        return compare_origin(flow, expected)
    except ValueError:
        return 'invalid-configuration'


def compare_origin(flow, expected):
    """校验配置后精确比较请求协议、主机和端口。"""
    if not valid_release_origin(expected):
        return 'invalid-configuration'
    actual = flow.request
    return 'matched' if (actual.scheme, actual.host, actual.port) == (
        expected.scheme, expected.hostname, expected.port) else 'different'


def release_upstream_match(flow):
    """独立核对实际 peer；未建连及 fixture 不充当来源证明。"""
    configured = release_origin_match(flow)
    if configured in ('unconfigured', 'invalid-configuration'):
        return configured
    if flow.metadata.get('diagnostic_source') == 'fixture':
        return 'not-applicable'
    return release_peer_match(flow.server_conn)


def release_peer_match(connection):
    """只比较实际已建立的 peer，不输出连接地址或猜测 HTTP 响应。"""
    if not all((connection.timestamp_tcp_setup is not None, connection.peername)):
        return 'unavailable'
    expected = urlsplit(os.environ['CLRN_RELEASE_WEB_URL'])
    matched = all((connection.transport_protocol == 'tcp', not connection.tls,
                   connection.peername[:2] == (expected.hostname, expected.port)))
    return 'matched' if matched else 'different'


def release_server(data):
    """只接受本轮发布目标的 TCP 连接钩子。"""
    try:
        expected = urlsplit(os.environ.get('CLRN_RELEASE_WEB_URL', ''))
        return server_matches(data, expected)
    except ValueError:
        return False


def server_matches(data, expected):
    """先校验发布配置，再比较连接目标。"""
    if not valid_release_origin(expected):
        return False
    return all((data.server.transport_protocol == 'tcp',
                data.server.address == (expected.hostname, expected.port)))


def timeout_reason(text):
    """只识别已知超时错误首部。"""
    return text in ('timeout', 'timed out', 'connection timed out') or re.fullmatch(
        r'\[errno (?:60|110|10060)\] (?:operation|connection) timed out', text)


def connection_failure(text):
    """识别锁定代理及操作系统的固定连接错误。"""
    exact = ('server closed connection', 'connection cancelled', 'connection closed by peer.',
             'connection refused', 'connection reset by peer')
    patterns = (r'\[errno (?:61|111|10061)\] (?:connect call failed|connection refused)(?: \([^\r\n]*\))?',
                r'\[errno (?:54|104|10054)\] connection reset by peer')
    return text in exact or any(re.fullmatch(pattern, text) for pattern in patterns)


def classify_error(text):
    """不会扫描地址、凭据和后续文本猜测错误原因。"""
    if timeout_reason(text):
        return 'timeout'
    return 'connection-failed' if connection_failure(text) else 'detail-withheld'


def error_reason(value):
    """仅处理字符串错误描述，其他类型一律隐藏。"""
    text = value.lower() if isinstance(value, str) else ''
    known = {'stream reset by client (cancel)': 'http2-stream-cancelled'}
    return known.get(text, classify_error(text))


def request_operation(flow):
    """区分发布资源读取与普通代理请求。"""
    return 'release-static-read' if release_origin_match(flow) == 'matched' else 'proxied-request'


def error_source(flow):
    """错误来源保持发布资源及业务代理分类。"""
    return 'release-static' if release_origin_match(flow) == 'matched' else 'laiwan_proxy'


def response_state(flow):
    """无响应时不猜测 HTTP 状态。"""
    if flow.response:
        return {'status': flow.response.status_code, 'response': 'received'}
    return {'status': 'unavailable', 'response': 'not-received'}


def release_identifier(flow):
    """响应编号需要真实来源和本轮服务标识共同证明。"""
    if not all((release_origin_match(flow) == 'matched', release_upstream_match(flow) == 'matched',
                flow.metadata.get('diagnostic_source') == 'upstream')):
        return 'unverified'
    return verified_identifier(flow)


def verified_identifier(flow):
    """只接受本轮 UUID 与正整数序号。"""
    identifier = flow.response.headers.get('X-Clrn-Release-Request', '')
    server_id = os.environ.get('CLRN_RELEASE_SERVER_ID', '')
    verified = all((re.fullmatch(r'[a-f0-9-]{36}', server_id),
                    re.fullmatch(re.escape(server_id) + r'-[1-9][0-9]*', identifier)))
    return identifier if verified else 'unverified'
