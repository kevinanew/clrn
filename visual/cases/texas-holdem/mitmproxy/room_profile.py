"""回放房间的盲注规则重复读取复用本轮真实成功响应，不补造规则。"""

from urllib.parse import urlsplit
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fixture_protocol import successful_flow, successful_result  # noqa: E402


class RoomProfile:
    """按房间、用户与认证来源缓存真实房间资料响应。"""
    def __init__(self):
        """初始化界面或缓存状态，确保首次使用从默认配置开始。"""
        self.release()

    def release(self):
        """清除房间资料归属与已缓存的真实响应。"""
        self.owner = None
        self.responses = {}

    def key(self, flow, room_id, self_id):
        """归属改变时清空缓存；只返回合法 GET 认证来源键。"""
        owner = (room_id, self_id)
        if self.owner != owner:
            self.release()
            self.owner = owner
        if not self.matches_read(flow, room_id, self_id):
            return None
        return self.authorization_key(flow)

    def matches_read(self, flow, room_id, self_id):
        """房间及用户必须同时绑定。"""
        if not room_id or not self_id:
            return False
        path = urlsplit(flow.request.path)
        return self.matches_path(flow.request.method, path, room_id)

    def matches_path(self, method, path, room_id):
        """仅缓存不带查询参数的确切房间资料 GET。"""
        return method == 'GET' and not path.query and path.path == f'/v10/texas_holdem/room/{room_id}/profile'

    def authorization_key(self, flow):
        """认证必须为非空 Bearer，Origin 参与缓存隔离。"""
        authorization = flow.request.headers.get('Authorization', '')
        if not authorization.startswith('Bearer ') or not authorization[7:].strip():
            return None
        return authorization, flow.request.headers.get('Origin', '')

    def read(self, flow, room_id, self_id):
        """读取与当前请求归属完全匹配的房间资料缓存。"""
        key = self.key(flow, room_id, self_id)
        if key is not None:
            return self.responses.get(key)
        return None

    def observe(self, flow, room_id, self_id):
        """仅缓存结构合法的真实成功响应。"""
        key = self.key(flow, room_id, self_id)
        if key is None:
            return
        if successful_flow(flow):
            self.cache_response(flow, key)

    def cache_response(self, flow, key):
        """JSON 错误保持原有忽略行为。"""
        try:
            body = flow.response.json()
            self.cache_body(body, key)
        except (ValueError, TypeError, AttributeError):
            pass

    def cache_body(self, body, key):
        """必须包含真实的计时规则列表。"""
        result = successful_result(body)
        if result is None:
            return
        if isinstance(result.get('all_time_based_rule'), list):
            self.responses[key] = body
