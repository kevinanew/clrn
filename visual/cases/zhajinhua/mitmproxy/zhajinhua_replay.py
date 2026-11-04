"""在真实房间连接上回放拼三张消息，禁止把夹具操作发送到游戏服务。"""

import json
import re
from mitmproxy import ctx

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]


class ZhajinhuaReplay:
    """为当前炸金花房间管理订阅、回放、操作奖励与虚拟玩家读取。"""
    def __init__(self):
        """初始化subscriptions、pending_subscriptions、room_id、replayed_messages、blocked_rpcs等状态。"""
        self.subscriptions = {}
        self.pending_subscriptions = {}
        self.room_id = None
        self.replayed_messages = 0
        self.blocked_rpcs = 0
        self.self_id = None
        self.operation_reward = False

    def publish(self, room_id, data):
        """校验房间归属与数据后向已确认订阅发布炸金花回放。"""
        if not isinstance(room_id, str) or not re.fullmatch(UUID, room_id, re.I) or not isinstance(data, dict):
            raise ValueError("Invalid replay")
        if self.room_id and room_id != self.room_id:
            raise ValueError('Another room already owns this replay')
        targets = [
            (flow, channel) for flow, channels in self.subscriptions.values()
            if flow.websocket.timestamp_end is None
            for channel in channels
            if re.fullmatch(rf"zhajinhua>{room_id}#{UUID}", channel, re.I)
        ]
        if not targets:
            raise ValueError("No subscribed Zhajinhua room")
        self.room_id = room_id
        self.self_id = targets[0][1].rsplit('#', 1)[-1]
        # Centrifuge v2 JSON 协议：无 id 的消息是服务端推送，type=0 表示 publication。
        for flow, channel in targets:
            payload = {"result": {"type": 0, "channel": channel, "data": {"data": data}}}
            ctx.master.commands.call("inject.websocket", flow, True, json.dumps(payload).encode(), True)
            self.replayed_messages += 1

    def release(self):
        """清除活动房间、当前玩家及操作奖励状态。"""
        self.room_id = None
        self.self_id = None
        self.operation_reward = False

    def set_operation_reward(self, room_id, enabled):
        """仅为已绑定的回放房间启用或关闭操作奖励。"""
        if not self.room_id or room_id != self.room_id or not isinstance(enabled, bool):
            raise ValueError('Operation reward requires the bound replay room')
        self.operation_reward = enabled

    def is_replay_publication(self, frame):
        """判断推送是否属于当前炸金花回放房间的数据流。"""
        result = frame.get('result')
        if 'id' in frame or not isinstance(result, dict) or result.get('type', 0) != 0:
            return False
        channel = result.get('channel')
        return isinstance(channel, str) and re.fullmatch(
            rf'zhajinhua>{self.room_id}#{UUID}', channel, re.I) is not None

    def websocket_message(self, flow):
        """跟踪房间订阅、确认与取消，仅隔离当前回放的限定消息。"""
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        try:
            frames = [json.loads(line) for line in message.text.splitlines() if line]
        except (ValueError, TypeError):
            return
        if not all(isinstance(frame, dict) for frame in frames):
            return
        if message.from_client:
            channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
            pending = self.pending_subscriptions.setdefault(flow.id, {})
            for frame in frames:
                params = frame.get("params") or {}
                if not isinstance(params, dict):
                    continue
                if (frame.get("method") == 1 and isinstance(frame.get('id'), int)
                        and frame['id'] > 0 and isinstance(params.get("channel"), str)):
                    pending[frame['id']] = params['channel']
                if frame.get("method") == 2 and isinstance(params.get('channel'), str):
                    channel = params.get('channel')
                    channels.discard(channel)
                    for command_id in [command_id for command_id, target in pending.items() if target == channel]:
                        pending.pop(command_id)
            # RPC 可走连接池另一条未订阅的连接；仍只匹配已经确认归属的房间 UUID。
            blocked = [frame for frame in frames if self.room_id and self.is_replay_rpc(frame)]
            if blocked:
                self.blocked_rpcs += len(blocked)
                kept = [frame for frame in frames if frame not in blocked]
                message.content = "\n".join(json.dumps(frame) for frame in kept).encode()
                if not kept:
                    message.drop()
                replies = [{"id": frame["id"], "result": {"data": self.rpc_result(frame)}}
                           for frame in blocked if "id" in frame]
                if replies:
                    ctx.master.commands.call("inject.websocket", flow, True,
                                             "\n".join(json.dumps(reply) for reply in replies).encode(), True)
        else:
            channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
            pending = self.pending_subscriptions.setdefault(flow.id, {})
            for frame in frames:
                command_id = frame.get('id') if isinstance(frame.get('id'), int) else None
                if command_id in pending:
                    channel = pending.pop(command_id)
                    if 'error' not in frame and isinstance(frame.get('result'), dict):
                        channels.add(channel)
                    else:
                        channels.discard(channel)
                result = frame.get('result')
                if ('id' not in frame and isinstance(result, dict) and result.get('type') == 3
                        and isinstance(result.get('channel'), str)):
                    channel = result.get('channel')
                    channels.discard(channel)
                    for command_id in [command_id for command_id, target in pending.items() if target == channel]:
                        pending.pop(command_id)
            if self.room_id:
                # 实际服务仍保持等待状态；丢弃其游戏推送，防止覆盖正在截图的固定对局。
                kept = [frame for frame in frames if not self.is_replay_publication(frame)]
                message.content = "\n".join(json.dumps(frame) for frame in kept).encode()
                if not kept:
                    message.drop()

    def websocket_end(self, flow):
        """连接关闭时移除已确认和待确认的炸金花订阅。"""
        self.subscriptions.pop(flow.id, None)
        self.pending_subscriptions.pop(flow.id, None)

    def is_replay_rpc(self, frame):
        """判断 RPC 是否属于当前回放房间支持的业务读取。"""
        if frame.get("method") != 9:
            return False
        params = frame.get("params") or {}
        data = params.get("data") if isinstance(params, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get('path'), str):
            return False
        if re.match(rf"/v\d+/zhajinhua/room/{self.room_id}(?:/|$)", data['path']):
            return True
        if re.match(rf"/v1/chat_room/{self.room_id}(?:/|$)", data['path']):
            return True
        return False

    def rpc_result(self, frame):
        """为当前房间的操作奖励或支持的读取 RPC 构造回放结果。"""
        path = frame['params']['data']['path']
        if self.operation_reward and re.fullmatch(
                rf'/v\d+/zhajinhua/room/{self.room_id}/game/[^/]+/(call|raise|all_in|challenge)', path):
            return {'ok': True, 'result': {
                'add_level_experience': 25, 'level_up': {'new_level': 6}}}
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return {'ok': True, 'result': {
                'users': [self.self_id] if self.self_id else [], 'user_id': self.self_id,
                'can_audio': True, 'can_video': True, 'has_joined': path.endswith('/join')}}
        return {'ok': True, 'result': {}}

    def profile(self, player_id):
        """为本人或已登记虚拟对手构造稳定展示资料。"""
        return {"user_id": player_id, "nickname": "TestPlayer" if player_id == self.self_id else
                f"Player{PLAYER_IDS.index(player_id) + 1}", "avatar_path": "", "gender": "male",
                "bio": "TestPlayer", "user_level": {"App:coin": {"level": 5, "progress": 0.5}},
                "last_used_nickname": ""}

    def http_fixture(self, path, body=b""):
        """按请求路径与批次只补充已登记虚拟玩家的资料和钱包数据。"""
        if not self.room_id:
            return None
        identifiers = PLAYER_IDS
        if path == '/v10/profile/users':
            requested = json.loads(body).get('users', [])
            if requested and all(identifier in identifiers for identifier in requested):
                return {identifier: self.profile(identifier) for identifier in requested}
            return None
        player_id = next((identifier for identifier in identifiers if identifier in path), None)
        if not player_id:
            return None
        if re.fullmatch(rf"/v10/profile/{UUID}", path):
            return self.profile(player_id)
        if re.fullmatch(rf"/v10/wallet/{UUID}/currency/coin", path):
            return {"balance": 12345}
        return None
