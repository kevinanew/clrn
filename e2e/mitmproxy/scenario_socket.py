"""共用场景的 WebSocket 行路由、支付隔离和有序回复。"""

import json
from mitmproxy import ctx
from response_overrides import is_staging
from scenario_data import MATCHING_PATHS
from scenario_http import slot_path


def command_payload(frame):
    """解析命令数据，保留损坏结构的异常行为。"""
    params = frame.get('params') or {}
    return params.get('data') or {}


def parse_websocket_command(line):
    """解析命令及其路由；无效帧交由调用者原样透传。"""
    frame = json.loads(line)
    if not isinstance(frame, dict):
        raise ValueError('Not a command')
    payload = command_payload(frame)
    path = payload.get('path', '')
    if not isinstance(path, str):
        raise ValueError('Not a path')
    return frame, payload, path


def client_text(message):
    """只处理客户端原始文本帧。"""
    return all((message.from_client, message.is_text, not message.injected))


def inject_replies(flow, replies):
    """按原顺序向客户端注入协议回复。"""
    if replies:
        ctx.master.commands.call('inject.websocket', flow, True,
                                 '\n'.join(json.dumps(reply) for reply in replies).encode(), True)


def write_forward(message, forward):
    """保留未处理行，只在剩余内容全空时丢弃原消息。"""
    message.content = '\n'.join(forward).encode()
    if not any(line.strip() for line in forward):
        message.drop()


class ScenarioSocket:
    """为具名场景隔离业务 RPC，其他消息保持原样。"""

    def socket_enabled(self, flow):
        """先确认场景，再限制真实来源及已建立长连接。"""
        if not any((self.name in ('slot', 'matching', 'mall'), self.visual)):
            return False
        return is_staging(flow.request.host) and bool(flow.websocket)

    def websocket_message(self, flow):
        """处理当前场景的 WebSocket 读取与支付隔离，保留无关消息。"""
        if not self.socket_enabled(flow):
            return
        message = flow.websocket.messages[-1]
        if not client_text(message):
            return
        self.socket_batch(flow, message)

    def socket_batch(self, flow, message):
        """逐行收集透传内容和回复，再统一写回。"""
        forward, replies = [], []
        handled = [self.socket_line(line, forward, replies) for line in message.text.split('\n')]
        if not any(handled):
            return
        write_forward(message, forward)
        inject_replies(flow, replies)

    def socket_line(self, line, forward, replies):
        """损坏或未命中的行完整透传。"""
        try:
            frame, payload, path = parse_websocket_command(line)
        except (ValueError, TypeError, AttributeError):
            forward.append(line)
            return False
        answer = self.socket_answer(frame, payload, path)
        return self.finish_line(frame, answer, line, forward, replies)

    def finish_line(self, frame, answer, line, forward, replies):
        """仅具名业务行被消耗，有 id 时才生成回复。"""
        if answer is None:
            forward.append(line)
            return False
        if 'id' in frame:
            replies.append({'id': frame['id'], 'result': {'data': answer}})
        return True

    def socket_answer(self, frame, payload, path):
        """按原优先级选择支付、老虎机或匹配响应。"""
        matching = self.name == 'matching' and path in MATCHING_PATHS
        slot = self.name == 'slot' and slot_path(path)
        payment = self.blocks_payment(path, payload.get('method'))
        return self.rpc_answer(frame, path, matching, slot, payment)

    def rpc_answer(self, frame, path, matching, slot, payment):
        """非 RPC 和未命中业务路径保持透传。"""
        if frame.get('method') != 9 or not any((matching, slot, payment)):
            return None
        return self.business_answer(path, slot, payment)

    def business_answer(self, path, slot, payment):
        """支付优先拒绝，匹配场景累计隔离写入。"""
        if payment:
            return {'ok': False, 'error': 'fixture_payment_forbidden'}
        if slot:
            return self.slot_reply(path)
        self.requests += 1
        return {'ok': True, 'result': {}}
