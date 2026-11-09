"""视觉回放共用的订阅确认、批次隔离和注入协议，所有实现采用测试预算。"""

import json
import re

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


def valid_uuid(value):
    """仅接受字符串 UUID，匹配大小写规则与原协议一致。"""
    return isinstance(value, str) and re.fullmatch(UUID, value, re.I)


def channel_matches(channel, game, room):
    """频道必须精确匹配玩法、房间和玩家 UUID。"""
    return isinstance(channel, str) and re.fullmatch(rf'{game}>{room}#{UUID}', channel, re.I) is not None


def encode_frames(frames):
    """保留 Centrifuge 每行一个 JSON 帧的编码。"""
    return '\n'.join(json.dumps(frame) for frame in frames).encode()


def replace_frames(message, frames):
    """重写批次，仅在没有保留帧时丢弃消息。"""
    message.content = encode_frames(frames)
    if not frames:
        message.drop()


def rpc_data(frame):
    """只从对象 params 中提取对象 data。"""
    params = frame.get('params') or {}
    if not isinstance(params, dict):
        return None
    return object_data(params)


def object_data(params):
    """非法 RPC data 结构保持不匹配。"""
    data = params.get('data')
    return data if isinstance(data, dict) else None


def rpc_path(frame):
    """非 RPC 或非字符串路径不参与房间匹配。"""
    if frame.get('method') != 9:
        return None
    data = rpc_data(frame)
    if data is None:
        return None
    return data.get('path')


def virtual_profiles(body, identifiers, profile):
    """批次必须非空且全部为已登记的虚拟玩家。"""
    requested = json.loads(body).get('users', [])
    if not requested:
        return None
    return profile_batch(requested, identifiers, profile)


def profile_batch(requested, identifiers, profile):
    """混入真实玩家的批次保持透传。"""
    if not registered_players(requested, identifiers):
        return None
    return {identifier: profile(identifier) for identifier in requested}


def registered_players(requested, identifiers):
    """整批玩家都必须出现在已登记集合。"""
    return all(identifier in identifiers for identifier in requested)


def path_player(path, identifiers):
    """按原顺序寻找路径中的已登记玩家标识。"""
    return next((identifier for identifier in identifiers if identifier in path), None)


def chat_result(path, self_id):
    """构造当前玩家的聊天读取或加入结果。"""
    return {'ok': True, 'result': {
        'users': [self_id] if self_id else [], 'user_id': self_id,
        'can_audio': True, 'can_video': True, 'has_joined': path.endswith('/join')}}


class ReplayTransport:
    """只跟踪已确认订阅，并隔离当前回放拥有的帧。"""

    def validate_publish(self, room_id, data):
        """拒绝非法数据和不同房间争用。"""
        if not valid_uuid(room_id) or not isinstance(data, dict):
            raise ValueError('Invalid replay')
        self.validate_owner(room_id)

    def validate_owner(self, room_id):
        """已绑定房间不得被另一房间替换。"""
        if self.room_id and room_id != self.room_id:
            raise ValueError('Another room already owns this replay')

    def flow_targets(self, flow, channels, room_id):
        """只从仍存活的连接中选择确切房间频道。"""
        if flow.websocket.timestamp_end is not None:
            return []
        return self.channel_targets(flow, channels, room_id)

    def channel_targets(self, flow, channels, room_id):
        """按频道顺序生成回放目标。"""
        return [(flow, channel) for channel in channels if channel_matches(channel, self.game, room_id)]

    def publish(self, room_id, data):
        """校验归属后向已确认订阅发布回放，保留注入方向和消息计数。"""
        self.validate_publish(room_id, data)
        targets = []
        for flow, channels in self.subscriptions.values():
            targets.extend(self.flow_targets(flow, channels, room_id))
        self.publish_targets(room_id, data, targets)

    def publish_targets(self, room_id, data, targets):
        """没有有效订阅时不绑定房间。"""
        if not targets:
            raise ValueError(f'No subscribed {self.label} room')
        self.room_id = room_id
        self.self_id = targets[0][1].rsplit('#', 1)[-1]
        for flow, channel in targets:
            payload = {'result': {'type': 0, 'channel': channel, 'data': {'data': data}}}
            self.inject(flow, json.dumps(payload).encode())
            self.replayed_messages += 1

    def is_replay_publication(self, frame):
        """只识别没有命令 id 的服务端 publication。"""
        if 'id' in frame or not isinstance(frame.get('result'), dict):
            return False
        result = frame['result']
        return self.publication_result(result)

    def publication_result(self, result):
        """缺省 type=0，频道仍须匹配当前房间。"""
        return result.get('type', 0) == 0 and channel_matches(result.get('channel'), self.game, self.room_id)

    def websocket_message(self, flow):
        """先解析完整批次，再进行订阅和回放处理。"""
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        self.parse_message(flow, message)

    def parse_message(self, flow, message):
        """非法 JSON 不改变原消息。"""
        try:
            frames = self.decode_frames(message.text)
        except (ValueError, TypeError):
            return
        self.route_frames(flow, message, frames)

    def decode_frames(self, text):
        """空行忽略，每个非空行独立解码。"""
        return [json.loads(line) for line in text.splitlines() if line]

    def route_frames(self, flow, message, frames):
        """任意非对象帧使整个批次保持透传。"""
        if not self.object_frames(frames):
            return
        channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
        pending = self.pending_subscriptions.setdefault(flow.id, {})
        handler = self.client_frames if message.from_client else self.server_frames
        handler(flow, message, frames, channels, pending)

    def object_frames(self, frames):
        """完整批次均须为 JSON 对象。"""
        return all(isinstance(frame, dict) for frame in frames)

    def client_frames(self, flow, message, frames, channels, pending):
        """先更新订阅，再按各玩法原有连接归属规则阻断 RPC。"""
        for frame in frames:
            self.client_subscription(frame, channels, pending)
        if self.target_flow(channels):
            self.block_rpcs(flow, message, frames)

    def client_subscription(self, frame, channels, pending):
        """忽略非对象 params。"""
        params = frame.get('params') or {}
        if isinstance(params, dict):
            self.channel_command(frame, params.get('channel'), channels, pending)

    def channel_command(self, frame, channel, channels, pending):
        """只有字符串频道才能订阅或取消。"""
        if isinstance(channel, str):
            self.subscription_command(frame, channel, channels, pending)

    def subscription_command(self, frame, channel, channels, pending):
        """取消订阅同时清理尚未确认的同频道命令。"""
        if frame.get('method') == 1:
            self.subscribe(frame.get('id'), channel, pending)
        if frame.get('method') == 2:
            self.unsubscribe(channel, channels, pending)

    def subscribe(self, command_id, channel, pending):
        """只登记正整数命令 id，等待服务端确认。"""
        if isinstance(command_id, int) and command_id > 0:
            pending[command_id] = channel

    def unsubscribe(self, channel, channels, pending):
        """清除频道及其待确认命令。"""
        channels.discard(channel)
        for command_id in self.pending_channel(pending, channel):
            pending.pop(command_id)

    def pending_channel(self, pending, channel):
        """先收集命令 id，避免遍历中修改字典。"""
        return [command_id for command_id, target in pending.items() if target == channel]

    def block_rpcs(self, flow, message, frames):
        """保留混合批次中的无关帧。"""
        blocked = self.blocked_frames(frames)
        if blocked:
            self.reply_blocked(flow, message, frames, blocked)

    def blocked_frames(self, frames):
        """每个帧独立匹配当前房间的 RPC。"""
        return [frame for frame in frames if self.is_replay_rpc(frame)]

    def reply_blocked(self, flow, message, frames, blocked):
        """按原帧相等性规则剔除阻断项。"""
        self.count_blocked(blocked)
        kept = [frame for frame in frames if frame not in blocked]
        replace_frames(message, kept)
        self.inject_replies(flow, self.rpc_replies(blocked))

    def rpc_replies(self, blocked):
        """无 id 通知不构造响应帧。"""
        return [self.rpc_reply(frame) for frame in blocked if 'id' in frame]

    def count_blocked(self, blocked):
        """仅需要诊断阻断计数的玩法覆写此钩子。"""

    def rpc_reply(self, frame):
        """保持 Centrifuge RPC 响应封装。"""
        return {'id': frame['id'], 'result': {'data': self.rpc_result(frame)}}

    def inject_replies(self, flow, replies):
        """没有响应帧时不执行注入命令。"""
        if replies:
            self.inject(flow, encode_frames(replies))

    def server_frames(self, flow, message, frames, channels, pending):
        """先确认订阅再过滤当前房间的真实 publication。"""
        for frame in frames:
            self.server_subscription(frame, channels, pending)
        if self.room_id:
            self.filter_publications(message, frames)

    def server_subscription(self, frame, channels, pending):
        """处理订阅命令确认与服务端取消订阅推送。"""
        command_id = frame.get('id') if isinstance(frame.get('id'), int) else None
        if command_id in pending:
            self.confirm_subscription(frame, pending.pop(command_id), channels)
        self.server_unsubscribe(frame, channels, pending)

    def confirm_subscription(self, frame, channel, channels):
        """仅没有错误且 result 为对象的确认才使频道生效。"""
        if 'error' not in frame and isinstance(frame.get('result'), dict):
            channels.add(channel)
        else:
            channels.discard(channel)

    def server_unsubscribe(self, frame, channels, pending):
        """带命令 id 的回复不作为取消订阅推送处理。"""
        if 'id' in frame or not isinstance(frame.get('result'), dict):
            return
        self.unsubscribe_result(frame['result'], channels, pending)

    def unsubscribe_result(self, result, channels, pending):
        """type 和频道均有效时清理订阅。"""
        if self.is_unsubscribe(result):
            self.unsubscribe(result['channel'], channels, pending)

    def is_unsubscribe(self, result):
        """type=3 且频道为字符串才是服务端取消订阅。"""
        return result.get('type') == 3 and isinstance(result.get('channel'), str)

    def filter_publications(self, message, frames):
        """实际服务保持连接，丢弃其当前回放房间的游戏推送。"""
        replace_frames(message, [frame for frame in frames if not self.is_replay_publication(frame)])

    def websocket_end(self, flow):
        """连接关闭同时清除已确认及待确认订阅。"""
        self.subscriptions.pop(flow.id, None)
        self.pending_subscriptions.pop(flow.id, None)

    def room_rpc(self, path):
        """只匹配本玩法房间和同房间聊天路径。"""
        if not isinstance(path, str):
            return False
        return re.match(rf'/v\d+/{self.game}/room/{self.room_id}(?:/|$)', path) or re.match(
            rf'/v1/chat_room/{self.room_id}(?:/|$)', path)
