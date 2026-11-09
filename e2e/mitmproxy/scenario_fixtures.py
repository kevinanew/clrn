"""应用、交互和动画共用的具名网络场景；未选择时完整透传。"""

import asyncio
import os
import re
from mitmproxy import ctx  # 公共模块路径保留既有诊断与测试注入入口。
from scenario_control import ScenarioControl
from scenario_http import ScenarioHttp
from scenario_response import ScenarioResponse
from scenario_socket import ScenarioSocket, parse_websocket_command

__all__ = ['ScenarioFixtures', 'ctx', 'parse_websocket_command']


class ScenarioFixtures(ScenarioControl, ScenarioHttp, ScenarioResponse, ScenarioSocket):
    """管理分页、商城、钱包与动画场景的可控 HTTP 和 WebSocket 夹具。"""
    def __init__(self):
        """初始化token、name、phase、visual、user_id等状态。"""
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.name = 'none'
        self.phase = 'ready'
        self.visual = False
        self.user_id = ''
        self.room_id = ''
        self.house_id = ''
        self.requests = self.held = self.spins = 0
        self.energy_reads = 0
        self.observed = []
        self.cursors = []
        self.gate = asyncio.Event()
        self.gate.set()

    def status(self):
        """返回场景请求、挂起、旋转与分页游标等观测状态。"""
        return {'requests': self.requests, 'held': self.held, 'spins': self.spins,
                'energyReads': self.energy_reads, 'observed': self.observed, 'cursors': self.cursors}

    def slot_reply(self, path):
        """记录老虎机读取并按用户、路径返回当前场景结果。"""
        self.requests += 1
        self.observed.append('9:' + re.sub(r'user/[^/]+', 'user/current', path))
        if not self.user_id or not path.startswith(f'/v2/slot_machine/user/{self.user_id}/'):
            return {'ok': False, 'error': 'fixture_owner_mismatch'}
        return self.owned_slot_reply(path)

    def owned_slot_reply(self, path):
        """仅所属账号请求计入旋转或能量读取。"""
        spin = path.endswith('/spin')
        if spin:
            self.spins += 1
        else:
            self.energy_reads += 1
        return self.slot_result(spin)

    def slot_result(self, spin):
        """按旋转与能量阶段构造老虎机能量、工厂和奖励数据。"""
        if spin and self.phase == 'exhausted':
            return {'ok': False, 'error': 'energy_not_enough', 'error_description': 'No energy'}
        return {'ok': True, 'result': self.slot_energy(spin)}

    def slot_energy(self, spin):
        """每次构造独立能量和工厂数据。"""
        energy = {'user_energy': {'total_energy': 0}, 'energy_factory': {
            'capacity': 50, 'quantity': 50, 'remaining_production_time': '00:00:00'}}
        if spin:
            currency = self.phase if self.phase in ('coin', 'currency_diamond', 'energy') else 'coin'
            energy.update(outcome=[currency] * 3, reward=self.slot_reward(currency))
        return energy

    def slot_reward(self, currency):
        """按固定币种表生成奖励，保留所有金额字段。"""
        prize = {'coin': 0, 'diamond': 0, 'energy': 0}
        key, amount = {'coin': ('coin', 100), 'currency_diamond': ('diamond', 5), 'energy': ('energy', 10)}[currency]
        prize[key] = amount
        return {'outcome_pattern': 'three', 'prize': prize}


addons = [ScenarioFixtures()]
