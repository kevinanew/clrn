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
from account_connection_diagnostics import AccountConnections, RoomConnections, account_connection_fields, room_error_fields

CONTROL_HOSTS = {'test-mitmproxy.invalid', 'fixtures-mitmproxy.invalid'}
PATH_TEMPLATES = [(path, path.split('/')) for path in json.loads(
    (Path(__file__).parent / 'data' / 'diagnostic-paths.json').read_text())]
EVENTS = {'proxy.request', 'proxy.response', 'proxy.nodes', 'proxy.nodes-filtered', 'proxy.error',
          'proxy.websocket-open', 'proxy.websocket-close', 'proxy.websocket-reply', 'proxy.websocket-command'}


def safe_path(value):
    """按登记的路径模板隐藏实体标识和查询信息，保留接口用途。"""
    if not isinstance(value, str) or not value.startswith('/') or value.startswith('//'):
        return '[未知接口]'
    segments = re.split(r'[?#]', value, maxsplit=1)[0].split('/')
    for path, template in PATH_TEMPLATES:
        if len(segments) == len(template) and all(
                segment not in ('', '.', '..') if expected.startswith('{') else segment == expected
                for segment, expected in zip(segments, template)):
            return path
    return '[未知接口]'


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
    host = urlsplit(value if '://' in value else 'https://' + value).hostname or 'unknown'
    return 'laiwan_proxy-' + hashlib.sha256(host.encode()).hexdigest()[:12]


def candidates(flow):
    """从节点元数据响应中提取候选主机并生成安全节点标识。"""
    if urlsplit(flow.request.path).path not in ('/public/v12/metadata/servers', '/public/v13/metadata/servers'):
        return None
    try:
        servers = flow.response.json()['result']['servers']
        return [node_name(name) for name in servers if isinstance(name, str)][:100]
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def release_origin_match(flow):
    """仅比较请求 URL，不代表实际套接字来源；公开日志不输出连接值。"""
    configured = os.environ.get('CLRN_RELEASE_WEB_URL')
    if not configured:
        return 'unconfigured'
    try:
        expected = urlsplit(configured)
        if (expected.scheme != 'http' or expected.hostname != '127.0.0.1'
                or expected.username or expected.password or not expected.port):
            return 'invalid-configuration'
        actual = flow.request
        return 'matched' if (actual.scheme, actual.host, actual.port) == (
            expected.scheme, expected.hostname, expected.port) else 'different'
    except ValueError:
        return 'invalid-configuration'


def release_upstream_match(flow):
    """独立核对已完成 TCP 建连的实际 peer；未建连及 fixture 不充当来源证明。"""
    configured = release_origin_match(flow)
    if configured in ('unconfigured', 'invalid-configuration'):
        return configured
    if flow.metadata.get('diagnostic_source') == 'fixture':
        return 'not-applicable'
    return release_peer_match(flow.server_conn)


def release_peer_match(connection):
    """只比较实际已建立的 peer，不输出连接地址或猜测 HTTP 响应。"""
    if connection.timestamp_tcp_setup is None or not connection.peername:
        return 'unavailable'
    expected = urlsplit(os.environ['CLRN_RELEASE_WEB_URL'])
    return 'matched' if (connection.transport_protocol == 'tcp'
                         and not connection.tls
                         and connection.peername[:2] == (expected.hostname, expected.port)) else 'different'


def error_reason(value):
    """只识别固定错误或已知 OS 错误首部，不从地址、凭据和后续文本猜测原因。"""
    text = value.lower() if isinstance(value, str) else ''
    if text == 'stream reset by client (cancel)':
        return 'http2-stream-cancelled'
    if text in ('timeout', 'timed out', 'connection timed out') or re.fullmatch(
            r'\[errno (?:60|110|10060)\] (?:operation|connection) timed out', text):
        return 'timeout'
    # mitmproxy 12.2.3 的 HTTP/1 断连及 asyncio 建连错误；连接值只参与匹配，绝不输出。
    if text in ('server closed connection', 'connection cancelled', 'connection closed by peer.',
                'connection refused', 'connection reset by peer') or re.fullmatch(
            r'\[errno (?:61|111|10061)\] (?:connect call failed|connection refused)(?: \([^\r\n]*\))?', text) or re.fullmatch(
            r'\[errno (?:54|104|10054)\] connection reset by peer', text):
        return 'connection-failed'
    return 'detail-withheld'


class ConnectionDiagnostics:
    """采集代理 HTTP、WebSocket 与上游连接的脱敏诊断时间线。"""
    def __init__(self):
        """初始化events、dropped、pending_commands状态。"""
        self.events = deque(maxlen=5000)
        self.dropped = 0
        self.pending_commands = {}
        self.room_connections = RoomConnections()
        self.account_connections = AccountConnections()

    def server_event(self, event, data):
        """仅收集本任务 Release 目标的真实连接钩子，不记录其他目标或异常正文。"""
        account = self.account_connections.fields(data, node_name)
        if account is not None:
            if len(self.events) == self.events.maxlen:
                self.dropped += 1
            self.events.append({'event': event, 'observedAt': int(time.time() * 1000), **account})
        room = self.room_connections.fields(data, node_name)
        if room is not None:
            if len(self.events) == self.events.maxlen:
                self.dropped += 1
            self.events.append({'event': event, 'observedAt': int(time.time() * 1000), **room})
        try:
            expected = urlsplit(os.environ.get('CLRN_RELEASE_WEB_URL', ''))
            if (expected.scheme != 'http' or expected.hostname != '127.0.0.1'
                    or expected.username or expected.password or not expected.port
                    or data.server.transport_protocol != 'tcp'
                    or data.server.address != (expected.hostname, expected.port)):
                return
        except ValueError:
            return
        if len(self.events) == self.events.maxlen:
            self.dropped += 1
        self.events.append({'event': event, 'observedAt': int(time.time() * 1000),
                            'source': 'release-static', 'operation': 'release-static-connect',
                            'connectionId': str(data.client.id),
                            'upstreamConnectionId': str(data.server.id),
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
        if len(self.events) == self.events.maxlen:
            self.dropped += 1
        entry = {'event': event if event in EVENTS else 'application.event', 'observedAt': int(time.time() * 1000),
                 'requestId': flow.id, 'node': node_name(flow.request.host),
                 'path': flow.request.path, 'method': flow.request.method,
                 'originMatch': release_origin_match(flow),
                 'upstreamMatch': release_upstream_match(flow),
                 'operation': 'release-static-read' if release_origin_match(flow) == 'matched' else 'proxied-request',
                 'connectionId': str(flow.client_conn.id),
                 'upstreamConnectionId': str(flow.server_conn.id), **fields}
        entry.update(account_connection_fields(flow))
        entry['path'] = safe_path(entry['path'])
        if 'reason' in entry:
            entry['reason'] = error_reason(entry['reason'])
        self.events.append({key: [safe_text(item).replace(flow.request.host, node_name(flow.request.host))
                                  for item in value] if isinstance(value, list)
                           else value if key in ('event', 'path')
                           else safe_text(value).replace(flow.request.host, node_name(flow.request.host))
                           if isinstance(value, str) else value for key, value in entry.items()})

    def snapshot(self):
        """返回已保存的诊断事件及丢弃计数。"""
        return {'events': list(self.events), 'dropped': self.dropped}

    def request(self, flow):
        """记录业务请求的来源与关联信息，排除代理控制流量。"""
        if flow.request.host in CONTROL_HOSTS:
            return
        self.room_connections.observe(flow)
        self.account_connections.observe(flow)
        source = 'fixture' if flow.response is not None else 'upstream'
        flow.metadata['diagnostic_source'] = source
        self.record('proxy.request', flow, source=source, fixtureHit=source == 'fixture',
                    operation='release-static-read' if release_origin_match(flow) == 'matched' else 'proxied-request')

    def response(self, flow):
        """记录真实响应状态及发布资源关联标识，并采集节点发现结果。"""
        if flow.request.host in CONTROL_HOSTS:
            return
        identifier = flow.response.headers.get('X-Clrn-Release-Request', '')
        server_id = os.environ.get('CLRN_RELEASE_SERVER_ID', '')
        release_id = identifier if (release_origin_match(flow) == 'matched'
                                   and release_upstream_match(flow) == 'matched'
                                   and flow.metadata.get('diagnostic_source') == 'upstream'
                                   and re.fullmatch(r'[a-f0-9-]{36}', server_id)
                                   and re.fullmatch(re.escape(server_id) + r'-[1-9][0-9]*', identifier)) else 'unverified'
        self.record('proxy.response', flow, releaseRequestId=release_id, source=flow.metadata.get('diagnostic_source', 'unknown'),
                    status=flow.response.status_code,
                    elapsedMs=round((time.time() - flow.request.timestamp_start) * 1000))
        before = flow.metadata.get('diagnostic_candidates_before')
        after = candidates(flow)
        if after is not None:
            self.record('proxy.nodes', flow, candidates=after)
        if before is not None:
            self.record('proxy.nodes-filtered', flow, before=[node_name(item) for item in before],
                        after=after or [], reason='代理改写节点列表')

    def error(self, flow):
        """为业务请求记录安全错误原因，避免猜测未收到的响应状态。"""
        if flow.request.host not in CONTROL_HOSTS:
            self.record('proxy.error', flow, reason=flow.error.msg if flow.error else 'unknown',
                        source='release-static' if release_origin_match(flow) == 'matched' else 'laiwan_proxy',
                        status=flow.response.status_code if flow.response else 'unavailable',
                        response='received' if flow.response else 'not-received', **room_error_fields(flow))

    def websocket_start(self, flow):
        """记录 WebSocket 建立事件及连接标识。"""
        self.record('proxy.websocket-open', flow, connectionId=flow.id)

    def websocket_end(self, flow):
        """记录 WebSocket 关闭信息并清除该连接的待确认命令。"""
        self.record('proxy.websocket-close', flow, connectionId=flow.id,
                    code=flow.websocket.close_code, reason=flow.websocket.close_reason)
        self.pending_commands.pop(flow.id, None)

    def websocket_message(self, flow):
        """仅记录 WebSocket 协议类型与关联编号，避免保存认证及业务正文。"""
        message = flow.websocket.messages[-1]
        if not message.is_text:
            return
        # 仅记录协议类型与关联编号，绝不保存认证帧、RPC 参数或业务推送正文。
        try:
            for line in message.text.splitlines()[:20]:
                frame = json.loads(line)
                if not isinstance(frame, dict):
                    continue
                method = frame.get('method')
                error = frame.get('error')
                identifier = frame.get('id')
                pending = self.pending_commands.setdefault(flow.id, {})
                if message.from_client and method in (1, 2, 9) and isinstance(identifier, int):
                    if len(pending) >= 1000:
                        pending.pop(next(iter(pending)))
                    pending[identifier] = {1: 'subscribe', 2: 'unsubscribe', 9: 'rpc'}[method]
                elif not message.from_client and identifier in pending:
                    self.record('proxy.websocket-reply', flow, connectionId=flow.id,
                                commandId=identifier, messageType=pending.pop(identifier),
                                outcome='error' if error is not None else 'success',
                                source='fixture' if message.injected else 'upstream')
                if method in (1, 2, 9) or error is not None:
                    self.record('proxy.websocket-command', flow, connectionId=flow.id,
                                source='fixture' if message.injected else 'client' if message.from_client else 'upstream',
                                messageType={1: 'subscribe', 2: 'unsubscribe', 9: 'rpc'}.get(method, 'error'),
                                commandId=frame.get('id') if isinstance(frame.get('id'), int) else None,
                                code=error.get('code') if isinstance(error, dict) and isinstance(error.get('code'), int) else None)
        except (ValueError, TypeError):
            pass

    def control(self, flow):
        """验证控制令牌后返回诊断快照，无效令牌返回拒绝访问。"""
        if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
            status, result = 403, {'error': 'Forbidden'}
        else:
            status, result = 200, self.snapshot()
        flow.response = http.Response.make(status, json.dumps(result).encode(), {'Content-Type': 'application/json'})
