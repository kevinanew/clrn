"""只记录 WebSocket 协议类型和关联编号的安全诊断。"""

import json

METHODS = {1: 'subscribe', 2: 'unsubscribe', 9: 'rpc'}


def integer_id(value):
    """协议编号只有整数可公开记录。"""
    return value if isinstance(value, int) else None


def error_code(error):
    """错误正文不保存，只允许整数错误码。"""
    return integer_id(error.get('code')) if isinstance(error, dict) else None


def message_source(message):
    """区分注入消息、客户端请求及上游消息。"""
    if message.injected:
        return 'fixture'
    return 'client' if message.from_client else 'upstream'


def outgoing_command(message, method, identifier):
    """只有客户端具名且带整数 id 的协议命令进入关联表。"""
    return all((message.from_client, method in (1, 2, 9), isinstance(identifier, int)))


class DiagnosticSocket:
    """维护有界关联表，保留每批最多二十行的原始错误边界。"""

    def websocket_message(self, flow):
        """仅记录 WebSocket 协议类型与关联编号。"""
        message = flow.websocket.messages[-1]
        if not message.is_text:
            return
        self.read_socket_lines(flow, message)

    def read_socket_lines(self, flow, message):
        """解析失败时结束本批记录，不向日志写入正文。"""
        try:
            for line in message.text.splitlines()[:20]:
                self.socket_frame(flow, message, json.loads(line))
        except (ValueError, TypeError):
            pass

    def socket_frame(self, flow, message, frame):
        """非对象帧跳过，合法帧分别关联和记录。"""
        if not isinstance(frame, dict):
            return
        method, error, identifier = frame.get('method'), frame.get('error'), frame.get('id')
        pending = self.pending_commands.setdefault(flow.id, {})
        self.correlate_command(flow, message, pending, method, identifier, error)
        if any((method in (1, 2, 9), error is not None)):
            self.record_command(flow, message, method, identifier, error)

    def correlate_command(self, flow, message, pending, method, identifier, error):
        """客户端请求登记，服务端回复消耗对应编号。"""
        if outgoing_command(message, method, identifier):
            self.remember_command(pending, identifier, method)
        elif self.is_reply(message, identifier, pending):
            self.record_reply(flow, message, pending, identifier, error)

    def is_reply(self, message, identifier, pending):
        """只有服务端消息可以消耗待确认编号。"""
        return not message.from_client and identifier in pending

    def remember_command(self, pending, identifier, method):
        """超过一千条时先移除最旧关联。"""
        if len(pending) >= 1000:
            pending.pop(next(iter(pending)))
        pending[identifier] = METHODS[method]

    def record_reply(self, flow, message, pending, identifier, error):
        """回复只记录结果分类，不保存协议正文。"""
        self.record('proxy.websocket-reply', flow, connectionId=flow.id,
                    commandId=identifier, messageType=pending.pop(identifier),
                    outcome='error' if error is not None else 'success',
                    source='fixture' if message.injected else 'upstream')

    def record_command(self, flow, message, method, identifier, error):
        """发布安全的协议类型、整数编号及整数错误码。"""
        self.record('proxy.websocket-command', flow, connectionId=flow.id,
                    source=message_source(message), messageType=METHODS.get(method, 'error'),
                    commandId=integer_id(identifier), code=error_code(error))
