"""场景命令校验、归属约束及闸门生命周期。"""

import asyncio
from urllib.parse import urlsplit
from scenario_data import PHASES, respond


def command_object(body):
    """控制命令必须是对象。"""
    if not isinstance(body, dict):
        raise ValueError('Expected command object')
    return body


def validate_scene(name, phase):
    """先验证类型再检查具名场景及阶段。"""
    if not all((isinstance(name, str), isinstance(phase, str))):
        raise ValueError('Unknown scenario or phase')
    if phase not in PHASES.get(name, ()):
        raise ValueError('Unknown scenario or phase')


def validate_owner_field(value):
    """账号与房间标识必须是非空字符串。"""
    if not isinstance(value, str) or not value:
        raise ValueError('Invalid owner')


def validate_fields(body):
    """拒绝响应载荷和未登记字段。"""
    if not set(body) <= {'name', 'phase', 'userId', 'roomId'}:
        raise ValueError('Response payloads are not accepted')
    for key in {'userId', 'roomId'} & body.keys():
        validate_owner_field(body[key])


def validate_room(proxy, body, name):
    """房间参数仅限已观测到真实建房结果的自动补充场景。"""
    if name == 'auto-rebuy':
        validate_observed_room(proxy, body)
    elif 'roomId' in body:
        raise ValueError('This scene has no room parameter')


def validate_observed_room(proxy, body):
    """要求非空且与真实创建响应中的房间一致。"""
    if not body.get('roomId') or body['roomId'] != proxy.room_id:
        raise ValueError('Room must be observed in a real creation response')


def validate_user(proxy, body):
    """已绑定代理不能被其他账号重新认领。"""
    if proxy.user_id:
        if proxy.user_id != body.get('userId', proxy.user_id):
            raise ValueError('Another user owns this proxy')


class ScenarioControl:
    """以原子校验后的命令更新场景状态。"""

    def control(self, flow):
        """校验令牌并执行夹具选择、释放与状态控制命令。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403)
            return
        try:
            self.dispatch_control(flow)
        except (ValueError, TypeError, KeyError, AttributeError):
            respond(flow, {'error': 'Invalid scenario command'}, 400)
            return
        respond(flow, self.status())

    def dispatch_control(self, flow):
        """按方法和路径执行唯一登记的控制动作。"""
        route = (flow.request.method, urlsplit(flow.request.path).path)
        handlers = {('POST', '/fixtures/select'): self.select,
                    ('POST', '/fixtures/environment'): self.environment,
                    ('GET', '/fixtures/status'): self.read_status}
        handlers[route](flow)

    def read_status(self, flow):
        """状态查询不改变场景。"""

    def environment(self, flow):
        """仅接受显式视觉环境命令。"""
        if flow.request.json() != {'visual': True}:
            raise ValueError('Unknown environment')
        self.visual = True

    def select(self, flow):
        """完整校验选择命令后才更新状态和闸门。"""
        body = command_object(flow.request.json())
        name, phase = body['name'], body.get('phase', 'ready')
        validate_scene(name, phase)
        validate_fields(body)
        validate_room(self, body, name)
        validate_user(self, body)
        self.select_validated(body, name, phase)

    def select_validated(self, body, name, phase):
        """先释放旧场景请求，再创建本阶段的新闸门。"""
        self.gate.set()
        if self.name != name:
            self.reset_observations()
        self.name, self.phase = name, phase
        self.user_id = body.get('userId', self.user_id)
        self.gate = asyncio.Event()
        if phase != 'hold':
            self.gate.set()

    def reset_observations(self):
        """切换具名场景时重置计数，同场景切阶段保留观测。"""
        self.requests = self.held = self.spins = 0
        self.energy_reads = 0
        self.observed, self.cursors = [], []

    async def wait(self):
        """累计挂起请求数并等待当前场景闸门放行。"""
        self.held += 1
        gate = self.gate
        await gate.wait()
