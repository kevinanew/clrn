"""在真实代理边界记录脱敏 HTTP、节点过滤和连接事件；从不保存请求正文或认证头。"""

from collections import deque
import json
import os
import re
import time
from urllib.parse import urlsplit
from mitmproxy import http

CONTROL_HOST = 'test-mitmproxy.invalid'


def safe_address(match):
    try:
        address = urlsplit(match.group(0))
        return f'{address.scheme}://{address.hostname}{address.path}'
    except ValueError:
        return '[地址已隐藏]'


def safe_text(value):
    text = str(value or '')
    text = re.sub(r'\b(?:https?|wss?)://[^\s<>"\'`)]+',
                  safe_address, text)
    text = re.sub(r'\.?shafayouxi\.com\b', '', text, flags=re.I)
    text = re.sub(r'\bBearer\s+[^\s,"\'}]+', 'Bearer [已隐藏]', text, flags=re.I)
    return re.sub(r'((?:access_token|refresh_token|authorization|password|cookie|token)["\']?\s*[:=]\s*["\']?)[^\s,"\';&}]+',
                  r'\1[已隐藏]', text, flags=re.I)[:2000]


def node_name(value):
    return safe_text(urlsplit(value if '://' in value else 'https://' + value).hostname or 'unknown')


def candidates(flow):
    if urlsplit(flow.request.path).path not in ('/public/v12/metadata/servers', '/public/v13/metadata/servers'):
        return None
    try:
        servers = flow.response.json()['result']['servers']
        return [node_name(name) for name in servers if isinstance(name, str)][:100]
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


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
                 'path': urlsplit(flow.request.path).path, 'method': flow.request.method, **fields}
        self.events.append({key: [safe_text(item) for item in value] if isinstance(value, list)
                           else safe_text(value) if isinstance(value, str) else value for key, value in entry.items()})

    def snapshot(self):
        return {'events': list(self.events), 'dropped': self.dropped}

    def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            return
        source = 'fixture' if flow.response is not None else 'upstream'
        flow.metadata['diagnostic_source'] = source
        self.record('proxy.request', flow, source=source)

    def response(self, flow):
        if flow.request.host == CONTROL_HOST:
            return
        self.record('proxy.response', flow, source=flow.metadata.get('diagnostic_source', 'unknown'),
                    status=flow.response.status_code,
                    elapsedMs=round((time.time() - flow.request.timestamp_start) * 1000))
        before = flow.metadata.get('diagnostic_candidates_before')
        after = candidates(flow)
        if after is not None:
            self.record('proxy.nodes', flow, candidates=after)
        if before is not None:
            self.record('proxy.nodes-filtered', flow, before=before, after=after or [], reason='代理改写节点列表')

    def error(self, flow):
        if flow.request.host != CONTROL_HOST:
            self.record('proxy.error', flow, reason=flow.error.msg if flow.error else 'unknown')

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
                                code=error.get('code') if isinstance(error, dict) else None)
        except (ValueError, TypeError):
            pass

    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
            status, result = 403, {'error': 'Forbidden'}
        else:
            status, result = 200, self.snapshot()
        flow.response = http.Response.make(status, json.dumps(result).encode(), {'Content-Type': 'application/json'})
