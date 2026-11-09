"""只修改本次真实创建的房间显示配置，服务端仍保留私人房等待状态。"""

import json
from texas_replay import valid_uuid
from fixture_protocol import creation_action, successful_result, successful_flow


class RoomView:
    """管理大厅、游客及新战绩入口的房间展示模式。"""
    def __init__(self):
        """初始化mode、room_id、self_id状态。"""
        self.mode = None
        self.room_id = None
        self.self_id = None

    def configure(self, mode):
        """校验房间展示模式并清除先前绑定的房间与用户。"""
        if mode not in (None, 'hall', 'record-v2', 'guest'):
            raise ValueError('Unknown room view')
        self.mode, self.room_id, self.self_id = mode, None, None

    def response(self, flow, path):
        """观察真实成功响应，再绑定建房或稳定本房间字段。"""
        if not self.mode or not successful_flow(flow):
            return
        self.read_response(flow, path)

    def read_response(self, flow, path):
        """保持 JSON 和结构异常的原有透传行为。"""
        try:
            body = json.loads(flow.response.content)
            self.apply_response(flow, path, body)
        except (ValueError, TypeError, AttributeError):
            return

    def apply_response(self, flow, path, body):
        """仅处理成功对象，绑定动作在显示覆盖之前。"""
        result = successful_result(body)
        if result is None:
            return
        if self.is_creation(flow, path):
            self.bind_created(json.loads(flow.request.content), result)
        self.patch_room(flow, path, body, result)

    def is_creation(self, flow, path):
        """只观察尚未绑定时的支付建房入口。"""
        return flow.request.method == 'POST' and path == '/v3/pay_action/do' and not self.room_id

    def bind_created(self, request, result):
        """只绑定合法的德州创建动作。"""
        if not creation_action(request):
            return
        if request['action_json'].get('game_type') not in ('texas_holdem', 'texas_react_native'):
            return
        self.bind_identifiers(request.get('user_id'), result.get('room_id'))

    def bind_identifiers(self, user_id, room_id):
        """房间和玩家均须为 UUID。"""
        if valid_uuid(user_id) and valid_uuid(room_id):
            self.room_id, self.self_id = room_id, user_id

    def patch_room(self, flow, path, body, result):
        """只有当前已绑定房间的确切 GET 能修改显示。"""
        if not self.room_id:
            return
        if (flow.request.method, path) == ('GET', f'/v1/room/{self.room_id}'):
            self.patch_mode(flow, body, result)

    def patch_mode(self, flow, body, result):
        """大厅和游客各自保留原有显示字段。"""
        handlers = {'hall': self.patch_hall, 'guest': self.patch_guest}
        handler = handlers.get(self.mode)
        if handler is not None:
            handler(result)
            flow.response.content = json.dumps(body).encode()

    def patch_hall(self, result):
        """大厅显示固定金币预测入口。"""
        result['building_type'] = 'hall'
        result.setdefault('game_config', {})['prediction_currency'] = 'coin'
        result['game_config']['currency'] = 'coin'

    def patch_guest(self, result):
        """游客仅覆盖创建者和管理员显示。"""
        result['creator_id'] = '00000000-0000-4000-8000-000000000001'
        result['admin_ids'] = []

    def fixture(self, path, method, self_id, content=b''):
        """只为当前大厅房间提供固定设置和预测规则。"""
        if self.mode != 'hall' or not self.room_id:
            return None
        return self.hall_fixture(path, method)

    def hall_fixture(self, path, method):
        """按方法与确切路径查询展示结果。"""
        routes = {
            ('PUT', f'/v10/texas_holdem/room/{self.room_id}/user_settings'): {'auto_rebuy': False},
            ('GET', f'/v10/texas_holdem/room/{self.room_id}/hand_prediction/rule'): {
                'rules': [{'prediction_type': 'pair', 'name': 'Pair', 'multiplier': 2,
                           'currency_name': 'coin', 'prediction_amount_range': [10, 20],
                           'default_prediction_amount': 10}]},
        }
        return routes.get((method, path))
