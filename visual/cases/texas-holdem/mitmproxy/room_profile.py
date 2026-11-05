"""回放房间的盲注规则重复读取复用本轮真实成功响应，不补造规则。"""

from urllib.parse import urlsplit


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
        """按房间、用户和请求认证信息生成缓存键，归属改变时清理旧缓存。"""
        owner = (room_id, self_id)
        if self.owner != owner:
            self.release()
            self.owner = owner
        authorization = flow.request.headers.get('Authorization', '')
        path = urlsplit(flow.request.path)
        if (not room_id or not self_id or flow.request.method != 'GET' or path.query
                or path.path != f'/v10/texas_holdem/room/{room_id}/profile'
                or not authorization.startswith('Bearer ') or not authorization[7:].strip()):
            return None
        return authorization, flow.request.headers.get('Origin', '')

    def read(self, flow, room_id, self_id):
        """读取与当前请求归属完全匹配的房间资料缓存。"""
        key = self.key(flow, room_id, self_id)
        if key is not None:
            return self.responses.get(key)
        return None

    def observe(self, flow, room_id, self_id):
        """仅缓存结构合法的成功房间资料响应，保留真实上游内容。"""
        key = self.key(flow, room_id, self_id)
        if key is None or not flow.response or flow.response.status_code != 200:
            return
        try:
            body = flow.response.json()
            result = body.get('result')
            if (body.get('ok') is True and isinstance(result, dict)
                    and isinstance(result.get('all_time_based_rule'), list)):
                self.responses[key] = body
        except (ValueError, TypeError, AttributeError):
            pass
