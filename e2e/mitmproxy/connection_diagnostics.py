"""在真实代理边界记录脱敏 HTTP、节点过滤和连接事件；从不保存请求正文或认证头。"""

from collections import deque
import hashlib
import ipaddress
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from diagnostic_release import (release_origin_match, release_upstream_match, release_peer_match,
                                error_reason, release_server, request_operation, error_source,
                                response_state, release_identifier)
from diagnostic_socket import DiagnosticSocket
from account_connection_diagnostics import account_connection_fields

CONTROL_HOSTS = {'test-mitmproxy.invalid', 'fixtures-mitmproxy.invalid'}
PATH_TEMPLATES = [(path, path.split('/')) for path in json.loads(
    (Path(__file__).parent / 'data' / 'diagnostic-paths.json').read_text())]
EVENTS = {'proxy.request', 'proxy.response', 'proxy.nodes', 'proxy.nodes-filtered', 'proxy.error',
          'proxy.websocket-open', 'proxy.websocket-close', 'proxy.websocket-reply', 'proxy.websocket-command'}


def safe_path(value):
    """按登记的路径模板隐藏实体标识和查询信息，保留接口用途。"""
    if not valid_path(value):
        return '[未知接口]'
    segments = re.split(r'[?#]', value, maxsplit=1)[0].split('/')
    return matching_path(segments)


def safe_address(match):
    """将匹配到的连接地址转换为脱敏节点名。"""
    try:
        address = urlsplit(match.group(0))
        return node_name(address.hostname or '')
    except ValueError:
        return '[地址已隐藏]'


def safe_text(value):
    """隐藏文本中的网络地址、认证头与凭据，只保留安全诊断内容。"""
    text = str(value or '')
    text = re.sub(r'\b(?:https?|wss?)://[^\s<>"\'`)]+',
                  safe_address, text, flags=re.I)
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b(?::\d+)?|\[[0-9a-fA-F:.]+\](?::\d+)?',
                  '[地址已隐藏]', text)
    text = re.sub(r'(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]+', safe_ipv6, text, flags=re.I)
    text = re.sub(r'\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b(?::\d+)?(?:/[^\s<>"\'`),;]*)?',
                  # 将文本中匹配的主机替换为稳定的安全节点名。
                  lambda match: node_name(match.group(0)), text, flags=re.I)
    text = re.sub(r'\bBearer\s+[^\s,"\'}]+', 'Bearer [已隐藏]', text, flags=re.I)
    return re.sub(r'((?:access_token|refresh_token|authorization|password|cookie|token)["\']?\s*[:=]\s*["\']?)[^\s,"\';&}]+',
                  r'\1[已隐藏]', text, flags=re.I)[:2000]


def safe_ipv6(match):
    """识别并隐藏合法 IPv6 地址，保留非地址文本。"""
    try:
        ipaddress.IPv6Address(match.group(0))
        return '[地址已隐藏]'
    except ValueError:
        return match.group(0)


def node_name(value):
    """将主机名映射为稳定的私有来源指纹，避免泄露连接资料。"""
    if re.fullmatch(r'laiwan_proxy-[a-f0-9]{12}', value):
        return value
    return hashed_host(value)


def candidates(flow):
    """从节点元数据响应中提取候选主机并生成安全节点标识。"""
    if urlsplit(flow.request.path).path not in ('/public/v12/metadata/servers', '/public/v13/metadata/servers'):
        return None
    try:
        return candidate_names(flow.response.json()['result']['servers'])
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


class ConnectionDiagnostics(DiagnosticSocket):
    """采集代理 HTTP、WebSocket 与上游连接的脱敏诊断时间线。"""
    def __init__(self):
        """初始化events、dropped、pending_commands状态。"""
        self.events = deque(maxlen=5000)
        self.dropped = 0
        self.pending_commands = {}

    def server_event(self, event, data):
        """仅收集本任务 Release 目标的真实连接钩子，不记录其他目标或异常正文。"""
        if not release_server(data):
            return
        self.append_event({'event': event, 'observedAt': int(time.time() * 1000),
                           'source': 'release-static', 'operation': 'release-static-connect',
                           'connectionId': str(data.client.id), 'upstreamConnectionId': str(data.server.id),
                           'upstreamMatch': release_peer_match(data.server)})

    def server_connect(self, data):
        """记录代理准备连接上游的事件。"""
        self.server_event('proxy.server-connect', data)

    def server_connected(self, data):
        """记录代理已连接到上游的事件。"""
        self.server_event('proxy.server-connected', data)

    def server_connect_error(self, data):
        """记录代理连接上游失败的事件。"""
        self.server_event('proxy.server-connect-error', data)

    def server_disconnected(self, data):
        """记录代理断开上游连接的事件。"""
        self.server_event('proxy.server-disconnected', data)

    def record(self, event, flow, **fields):
        """限量保存当前流的安全诊断字段，并累计被丢弃的事件数。"""
        entry = {'event': event if event in EVENTS else 'application.event', 'observedAt': int(time.time() * 1000),
                 'requestId': flow.id, 'node': node_name(flow.request.host),
                 'path': flow.request.path, 'method': flow.request.method,
                 'originMatch': release_origin_match(flow), 'upstreamMatch': release_upstream_match(flow),
                 'operation': request_operation(flow), 'connectionId': str(flow.client_conn.id),
                 'upstreamConnectionId': str(flow.server_conn.id), **fields}
        entry['path'] = safe_path(entry['path'])
        entry.update(account_connection_fields(flow))
        if 'reason' in entry:
            entry['reason'] = error_reason(entry['reason'])
        self.append_event(sanitized_entry(entry, flow.request.host))

    def append_event(self, entry):
        """统一维护有界事件队列和丢弃计数。"""
        if len(self.events) == self.events.maxlen:
            self.dropped += 1
        self.events.append(entry)

    def record_candidates(self, flow):
        """分别记录候选节点和过滤前后的节点列表。"""
        before = flow.metadata.get('diagnostic_candidates_before')
        after = candidates(flow)
        if after is not None:
            self.record('proxy.nodes', flow, candidates=after)
        if before is not None:
            self.record('proxy.nodes-filtered', flow, before=node_names(before),
                        after=empty_nodes(after), reason='代理改写节点列表')

    def snapshot(self):
        """返回已保存的诊断事件及丢弃计数。"""
        return {'events': list(self.events), 'dropped': self.dropped}

    def request(self, flow):
        """记录业务请求的来源与关联信息，排除代理控制流量。"""
        if flow.request.host in CONTROL_HOSTS:
            return
        source = 'fixture' if flow.response is not None else 'upstream'
        flow.metadata['diagnostic_source'] = source
        self.record('proxy.request', flow, source=source, fixtureHit=source == 'fixture',
                    operation=request_operation(flow))

    def response(self, flow):
        """记录真实响应状态及发布资源关联标识，并采集节点发现结果。"""
        if flow.request.host in CONTROL_HOSTS:
            return
        self.record('proxy.response', flow, releaseRequestId=release_identifier(flow),
                    source=flow.metadata.get('diagnostic_source', 'unknown'), status=flow.response.status_code,
                    elapsedMs=round((time.time() - flow.request.timestamp_start) * 1000))
        self.record_candidates(flow)

    def error(self, flow):
        """为业务请求记录安全错误原因，避免猜测未收到的响应状态。"""
        if flow.request.host not in CONTROL_HOSTS:
            self.record('proxy.error', flow, reason=flow.error.msg if flow.error else 'unknown',
                        source=error_source(flow), **response_state(flow))

    def websocket_start(self, flow):
        """记录 WebSocket 建立事件及连接标识。"""
        self.record('proxy.websocket-open', flow, connectionId=flow.id)

    def websocket_end(self, flow):
        """记录 WebSocket 关闭信息并清除该连接的待确认命令。"""
        self.record('proxy.websocket-close', flow, connectionId=flow.id,
                    code=flow.websocket.close_code, reason=flow.websocket.close_reason,
                    source={True: 'client', False: 'upstream'}.get(
                        getattr(flow.websocket, 'closed_by_client', None), 'unknown'))
        self.pending_commands.pop(flow.id, None)


    def control(self, flow):
        """验证控制令牌后返回诊断快照，无效令牌返回拒绝访问。"""
        if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
            status, result = 403, {'error': 'Forbidden'}
        else:
            status, result = 200, self.snapshot()
        flow.response = http.Response.make(status, json.dumps(result).encode(), {'Content-Type': 'application/json'})


def valid_path(value):
    """路径必须是单斜线开头的字符串。"""
    if not isinstance(value, str):
        return False
    return value.startswith('/') and not value.startswith('//')


def matching_path(segments):
    """按登记顺序匹配第一个合法接口模板。"""
    for path, template in PATH_TEMPLATES:
        if template_matches(segments, template):
            return path
    return '[未知接口]'


def template_matches(segments, template):
    """段数相同才逐段验证模板。"""
    if len(segments) != len(template):
        return False
    return all(segment_matches(segment, expected) for segment, expected in zip(segments, template))


def segment_matches(segment, expected):
    """占位段禁止空值及相对目录段，固定段精确匹配。"""
    return segment not in ('', '.', '..') if expected.startswith('{') else segment == expected


def hashed_host(value):
    """只对主机名计算稳定指纹。"""
    host = urlsplit(value if '://' in value else 'https://' + value).hostname or 'unknown'
    return 'laiwan_proxy-' + hashlib.sha256(host.encode()).hexdigest()[:12]


def candidate_names(servers):
    """最多公开一百个字符串候选节点的指纹。"""
    return [node_name(name) for name in servers if isinstance(name, str)][:100]


def sanitized_text(value, host):
    """删除当前请求主机的残余原文。"""
    return safe_text(value).replace(host, node_name(host))


def sanitized_value(key, value, host):
    """列表逐项脱敏，已验证的事件名和路径模板保持语义。"""
    if isinstance(value, list):
        return sanitized_list(value, host)
    if key in ('event', 'path'):
        return value
    return sanitized_scalar(value, host)


def sanitized_list(value, host):
    """列表中的每项都采用文本脱敏。"""
    return [sanitized_text(item, host) for item in value]


def sanitized_scalar(value, host):
    """仅字符串执行文本替换，数字布尔及空值保留类型。"""
    return sanitized_text(value, host) if isinstance(value, str) else value


def sanitized_entry(entry, host):
    """逐字段构造可公开的诊断事件。"""
    return {key: sanitized_value(key, value, host) for key, value in entry.items()}


def node_names(nodes):
    """转换完整过滤前节点列表。"""
    return [node_name(item) for item in nodes]


def empty_nodes(nodes):
    """未取得候选列表时保留空列表诊断约定。"""
    return nodes or []
