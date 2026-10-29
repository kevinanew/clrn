"""在真实代理边界记录脱敏 HTTP、节点过滤和连接事件；从不保存请求正文或认证头。"""

from collections import deque
import hashlib
import ipaddress
import json
import os
import re
import time
from urllib.parse import urlsplit
from mitmproxy import http

CONTROL_HOSTS = {'test-mitmproxy.invalid', 'fixtures-mitmproxy.invalid'}


def safe_address(match):
    try:
        address = urlsplit(match.group(0))
        return node_name(address.hostname or '')
    except ValueError:
        return '[地址已隐藏]'


def safe_text(value):
    text = str(value or '')
    text = re.sub(r'\b(?:https?|wss?)://[^\s<>"\'`)]+',
                  safe_address, text, flags=re.I)
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b(?::\d+)?|\[[0-9a-fA-F:.]+\](?::\d+)?',
                  '[地址已隐藏]', text)
    text = re.sub(r'(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]+', safe_ipv6, text, flags=re.I)
    text = re.sub(r'\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b(?::\d+)?(?:/[^\s<>"\'`),;]*)?',
                  lambda match: node_name(match.group(0)), text, flags=re.I)
    text = re.sub(r'\bBearer\s+[^\s,"\'}]+', 'Bearer [已隐藏]', text, flags=re.I)
    return re.sub(r'((?:access_token|refresh_token|authorization|password|cookie|token)["\']?\s*[:=]\s*["\']?)[^\s,"\';&}]+',
                  r'\1[已隐藏]', text, flags=re.I)[:2000]


def safe_ipv6(match):
    try:
        ipaddress.IPv6Address(match.group(0))
        return '[地址已隐藏]'
    except ValueError:
        return match.group(0)


def node_name(value):
    if re.fullmatch(r'laiwan_prd-[a-f0-9]{12}', value):
        return value
    host = urlsplit(value if '://' in value else 'https://' + value).hostname or 'unknown'
    return 'laiwan_prd-' + hashlib.sha256(host.encode()).hexdigest()[:12]


def candidates(flow):
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
    connection = flow.server_conn
    if connection.timestamp_tcp_setup is None or not connection.peername:
        return 'unavailable'
    expected = urlsplit(os.environ['CLRN_RELEASE_WEB_URL'])
    return 'matched' if (connection.transport_protocol == 'tcp'
                         and not connection.tls
                         and connection.peername[:2] == (expected.hostname, expected.port)) else 'different'


def error_reason(value):
    """仅保留审阅的错误类别，任意服务端文本与深层异常不得进入持久化记录。"""
    text = str(value or '').lower()
    if 'timeout' in text or 'timed out' in text:
        return 'timeout'
    if 'connection' in text or 'disconnect' in text:
        return 'connection-failed'
    return 'detail-withheld'


class ConnectionDiagnostics:
    def __init__(self):
        self.events = deque(maxlen=5000)
        self.dropped = 0
        self.pending_commands = {}

    def record(self, event, flow, **fields):
        if len(self.events) == self.events.maxlen:
            self.dropped += 1
        entry = {'event': event, 'observedAt': int(time.time() * 1000),
                 'requestId': flow.id, 'node': node_name(flow.request.host),
                 'path': urlsplit(flow.request.path).path, 'method': flow.request.method,
                 'originMatch': release_origin_match(flow),
                 'upstreamMatch': release_upstream_match(flow),
                 'operation': 'release-static-read' if release_origin_match(flow) == 'matched' else 'proxied-request',
                 'connectionId': str(flow.client_conn.id),
                 'upstreamConnectionId': str(flow.server_conn.id), **fields}
        if 'reason' in entry:
            entry['reason'] = error_reason(entry['reason'])
        self.events.append({key: [safe_text(item).replace(flow.request.host, node_name(flow.request.host))
                                  for item in value] if isinstance(value, list)
                           else value if key in ('event', 'path')
                           else safe_text(value).replace(flow.request.host, node_name(flow.request.host))
                           if isinstance(value, str) else value for key, value in entry.items()})

    def snapshot(self):
        return {'events': list(self.events), 'dropped': self.dropped}

    def request(self, flow):
        if flow.request.host in CONTROL_HOSTS:
            return
        source = 'fixture' if flow.response is not None else 'upstream'
        flow.metadata['diagnostic_source'] = source
        self.record('proxy.request', flow, source=source, fixtureHit=source == 'fixture',
                    operation='release-static-read' if release_origin_match(flow) == 'matched' else 'proxied-request')

    def response(self, flow):
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
        if flow.request.host not in CONTROL_HOSTS:
            self.record('proxy.error', flow, reason=flow.error.msg if flow.error else 'unknown',
                        source='release-static' if release_origin_match(flow) == 'matched' else 'laiwan_prd',
                        status=flow.response.status_code if flow.response else 'unavailable',
                        response='received' if flow.response else 'not-received')

    def websocket_start(self, flow):
        self.record('proxy.websocket-open', flow, connectionId=flow.id)

    def websocket_end(self, flow):
        self.record('proxy.websocket-close', flow, connectionId=flow.id,
                    code=flow.websocket.close_code, reason=flow.websocket.close_reason)
        self.pending_commands.pop(flow.id, None)

    def websocket_message(self, flow):
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
        if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
            status, result = 403, {'error': 'Forbidden'}
        else:
            status, result = 200, self.snapshot()
        flow.response = http.Response.make(status, json.dumps(result).encode(), {'Content-Type': 'application/json'})
