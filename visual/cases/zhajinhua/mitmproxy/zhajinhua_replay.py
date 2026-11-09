"""在真实房间连接上回放拼三张消息，禁止把夹具操作发送到游戏服务。"""

import re
import sys
from pathlib import Path
from mitmproxy import ctx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from replay_transport import (ReplayTransport, rpc_path, virtual_profiles,
                              path_player, chat_result)  # noqa: E402

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]


class ZhajinhuaReplay(ReplayTransport):
    """为当前炸金花房间管理订阅、回放、操作奖励与虚拟玩家读取。"""
    game = 'zhajinhua'
    label = 'Zhajinhua'

    def __init__(self):
        """初始化subscriptions、pending_subscriptions、room_id、replayed_messages、blocked_rpcs等状态。"""
        self.subscriptions = {}
        self.pending_subscriptions = {}
        self.room_id = None
        self.replayed_messages = 0
        self.blocked_rpcs = 0
        self.self_id = None
        self.operation_reward = False

    def release(self):
        """清除活动房间、当前玩家及操作奖励状态。"""
        self.room_id = None
        self.self_id = None
        self.operation_reward = False

    def set_operation_reward(self, room_id, enabled):
        """操作奖励必须使用布尔值且绑定当前回放房间。"""
        if not self.room_id or room_id != self.room_id:
            raise ValueError('Operation reward requires the bound replay room')
        self.validate_reward(enabled)
        self.operation_reward = enabled

    def validate_reward(self, enabled):
        """保持非法奖励开关的错误传播。"""
        if not isinstance(enabled, bool):
            raise ValueError('Operation reward requires the bound replay room')

    def count_blocked(self, blocked):
        """记录被隔离 RPC 数，包括无 id 的通知。"""
        self.blocked_rpcs += len(blocked)

    def is_replay_rpc(self, frame):
        """只隔离已绑定房间的 RPC。"""
        return bool(self.room_rpc(rpc_path(frame)))

    def inject(self, flow, content):
        """通过当前代理的 mitmproxy 上下文向浏览器注入。"""
        ctx.master.commands.call('inject.websocket', flow, True, content, True)

    def target_flow(self, channels):
        """玩法自己的连接归属规则。"""
        return bool(self.room_id)

    def rpc_result(self, frame):
        """保持奖励操作与聊天读取的响应语义。"""
        path = frame['params']['data']['path']
        if self.reward_path(path):
            return {'ok': True, 'result': {'add_level_experience': 25, 'level_up': {'new_level': 6}}}
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return chat_result(path, self.self_id)
        return {'ok': True, 'result': {}}

    def reward_path(self, path):
        """奖励只对当前回放的四种操作生效。"""
        return self.operation_reward and re.fullmatch(
            rf'/v\d+/zhajinhua/room/{self.room_id}/game/[^/]+/(call|raise|all_in|challenge)', path)

    def profile(self, player_id):
        """为本人或已登记虚拟对手构造稳定展示资料。"""
        return {"user_id": player_id, "nickname": "TestPlayer" if player_id == self.self_id else
                f"Player{PLAYER_IDS.index(player_id) + 1}", "avatar_path": "", "gender": "male",
                "bio": "TestPlayer", "user_level": {"App:coin": {"level": 5, "progress": 0.5}},
                "last_used_nickname": ""}

    def http_fixture(self, path, body=b''):
        """只补充已登记虚拟玩家的资料和钱包读取。"""
        if not self.room_id:
            return None
        if path == '/v10/profile/users':
            return virtual_profiles(body, PLAYER_IDS, self.profile)
        return self.player_fixture(path)

    def player_fixture(self, path):
        """路径必须包含已登记玩家标识。"""
        player_id = path_player(path, PLAYER_IDS)
        if not player_id:
            return None
        if re.fullmatch(rf'/v10/profile/{UUID}', path):
            return self.profile(player_id)
        return self.wallet_fixture(path)

    def wallet_fixture(self, path):
        """只匹配固定钱包和统计路径。"""
        if re.fullmatch(rf'/v10/wallet/{UUID}/currency/coin', path):
            return {'balance': 12345}
        return None
