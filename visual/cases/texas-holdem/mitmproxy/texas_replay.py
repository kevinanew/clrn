"""在真实房间连接上回放德州消息，禁止把夹具操作发送到游戏服务。"""

import re
import sys
from pathlib import Path
from mitmproxy import ctx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from replay_transport import (ReplayTransport, rpc_path, virtual_profiles,
                              path_player, chat_result, rpc_data, valid_uuid as valid_uuid)  # noqa: E402

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]
TABLE_PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 9)]


class TexasReplay(ReplayTransport):
    """为当前德州房间管理订阅、帧重放与限定读取夹具。"""
    game = 'texas_holdem'
    label = 'Texas'

    def __init__(self):
        """初始化subscriptions、pending_subscriptions、room_id、replayed_messages、self_id等状态。"""
        self.subscriptions = {}
        self.pending_subscriptions = {}
        self.room_id = None
        self.replayed_messages = 0
        self.self_id = None
        self.created_room_id = None
        self.ui_states = None

    def arm_created_room(self, room_id, self_id):
        """将真实创建的房间及当前玩家绑定到德州重放状态。"""
        self.room_id = self.created_room_id = room_id
        self.self_id = self_id

    def room_subscribed(self):
        """只有存活连接上已确认的本房间频道才表示可回放。"""
        return any(self.flow_targets(flow, channels, self.room_id)
                   for flow, channels in self.subscriptions.values())

    def release(self):
        """清除活动房间、当前玩家、创建房间与界面状态绑定。"""
        self.room_id = None
        self.self_id = None
        self.created_room_id = None
        self.ui_states = None

    def is_replay_rpc(self, frame):
        """房间和聊天读取之外，仅隔离两种限定支付动作。"""
        path = rpc_path(frame)
        if not isinstance(path, str):
            return False
        if self.room_rpc(path):
            return True
        return self.pay_rpc(frame, path)

    def pay_rpc(self, frame, path):
        """支付 RPC 必须使用固定路径和 POST 方法。"""
        data = rpc_data(frame)
        if (path, data.get('method')) != ('/v3/pay_action/do', 'POST'):
            return False
        return self.pay_action(data.get('json') or {})

    def pay_action(self, body):
        """只接受当前房间的公共牌查看和操作时间支付夹具。"""
        action = body.get('action_url') if isinstance(body, dict) else None
        if not isinstance(action, dict):
            return False
        return self.allowed_action(action)

    def allowed_action(self, action):
        """支付动作表保持固定版本和占位符路径。"""
        allowed = (
            ('PUT', '/v10/texas_holdem/room/$room_id$/game/$game_id$/check_community_card'),
            ('POST', '/v10/texas_holdem/room/$room_id$/game/$game_id$/operating_time'),
        )
        return action.get('room_id') == self.room_id and (action.get('method'), action.get('path')) in allowed

    def inject(self, flow, content):
        """通过当前代理的 mitmproxy 上下文向浏览器注入。"""
        ctx.master.commands.call('inject.websocket', flow, True, content, True)

    def target_flow(self, channels):
        """新建房间在订阅前即隔离，其他回放要求本连接频道。"""
        if not self.room_id:
            return False
        if self.created_room_id == self.room_id:
            return True
        return self.has_room_channel(channels)

    def has_room_channel(self, channels):
        """沿用原有大小写敏感的连接归属前缀。"""
        return any(channel.startswith(f'texas_holdem>{self.room_id}#') for channel in channels)

    def rpc_result(self, frame):
        """优先使用界面错误，否则生成房间操作结果。"""
        error = self.ui_states.rpc_result(frame) if self.ui_states else None
        if error is not None:
            return error
        return self.operation_result(frame['params']['data']['path'])

    def operation_result(self, path):
        """保持聊天、经验与升级响应协议。"""
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return chat_result(path, self.self_id)
        props = {'add_level_experience': 12}
        if path.endswith('/call'):
            props['level_up'] = {'new_level': 6}
        return {'ok': True, 'result': {**props, 'community_card': ['ah', 'kd', '7c', '2s', 'qs']}}

    def profile(self, player_id):
        """为本人或已登记虚拟对手构造稳定的展示资料。"""
        return {"user_id": player_id, "nickname": "TestPlayer" if player_id == self.self_id else
                f"Player{TABLE_PLAYER_IDS.index(player_id) + 1}", "avatar_path": "", "gender": "male",
                "bio": "TestPlayer", "user_level": {"App:coin": {"level": 5, "progress": 0.5}},
                "last_used_nickname": ""}

    def http_fixture(self, path, body=b''):
        """只补充已登记虚拟玩家的资料和钱包读取。"""
        if not self.room_id:
            return None
        if path == '/v10/profile/users':
            return virtual_profiles(body, TABLE_PLAYER_IDS, self.profile)
        return self.player_fixture(path)

    def player_fixture(self, path):
        """路径必须包含已登记玩家标识。"""
        player_id = path_player(path, TABLE_PLAYER_IDS)
        if not player_id:
            return None
        if re.fullmatch(rf'/v10/profile/{UUID}', path):
            return self.profile(player_id)
        return self.wallet_fixture(path)

    def wallet_fixture(self, path):
        """只匹配固定钱包和统计路径。"""
        if re.fullmatch(rf'/v10/wallet/{UUID}/currency/coin', path):
            return {'balance': 12345}
        if re.fullmatch(rf'/v1/texas_statistics/player/{UUID}/rounds/(100|1000)', path):
            return self.statistics(path)
        return None

    def statistics(self, path):
        """构造固定玩家的德州统计资料。"""
        return {"total_hands": int(path.rsplit("/", 1)[-1]), "vpip": 0.25, "pfr": 0.18,
                "af": 2.5, "c_bet": 0.6, "fold_to_c_bet": 0.4, "fold_to_steal": 0.5,
                "fold_to_three_bet": 0.5, "steal": 0.3, "three_bet": 0.08,
                "win_rate": 0.2, "win_rate_vp": 0.3, "win_rate_wtsd": 0.5, "wtsd": 0.3}
