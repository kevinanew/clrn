"""应用、交互和动画共用的具名网络场景；未选择时完整透传。"""

import asyncio
import copy
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from mitmproxy import ctx, http
from response_overrides import is_staging, patch_result

CONTROL_HOST = 'fixtures-mitmproxy.invalid'
DATA = Path(__file__).with_name('data')
MATCHING_PATHS = {f'/v1/hall_matching/{action}' for action in ('join', 'quit', 'keep_waiting')}
SCENES = {'none', 'daily-bonus', 'club-empty', 'wallet-empty', 'mall',
          'invitation', 'matching', 'slot', 'club-skeleton', 'launch', 'pagination',
          'club-error', 'hall-error', 'auto-rebuy'}
PHASES = {name: {'ready'} for name in SCENES}
for name in ('launch', 'club-skeleton', 'auto-rebuy'):
    PHASES[name] |= {'hold', 'release'}
for name in ('club-error', 'hall-error'):
    PHASES[name].add('release')
PHASES['slot'] |= {'coin', 'currency_diamond', 'energy', 'exhausted'}


def data(name):
    return json.loads((DATA / f'{name}.json').read_text())


def respond(flow, body, status=200):
    flow.response = http.Response.make(status, json.dumps(body).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
    })


def result(flow, body):
    respond(flow, {'ok': True, 'result': body})


def clubs():
    return [{'id': f'00000000-0000-4000-8000-00000000010{i}', 'club_no': 100 + i,
             'name': f'TestClub{i}', 'owner_id': 'visual-owner', 'member_count': 5,
             'created_at': '2026-01-01T00:00:00Z', 'admin_ids': [], 'game_type': 'texas_holdem'}
            for i in (1, 2)]


def applications(start, count):
    return [{'application_id': f'interaction-{i}', 'status': 'approve', 'amount': 100,
             'user_id': 'interaction-player', 'created_at': '2026-09-01T00:00:00Z',
             'auditor_id': 'interaction-auditor', 'nickname': f'滚动玩家{i}',
             'building_name': '交互测试', 'room_name': '分页牌局'} for i in range(start, start + count)]


class ScenarioFixtures:
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.name = 'none'
        self.phase = 'ready'
        self.visual = False
        self.user_id = ''
        self.room_id = ''
        self.house_id = ''
        self.requests = self.held = self.spins = 0
        self.observed = []
        self.cursors = []
        self.gate = asyncio.Event()
        self.gate.set()

    def status(self):
        return {'requests': self.requests, 'held': self.held, 'spins': self.spins,
                'observed': self.observed, 'cursors': self.cursors}

    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403)
            return
        path = urlsplit(flow.request.path).path
        try:
            if path == '/fixtures/select' and flow.request.method == 'POST':
                body = flow.request.json()
                if not isinstance(body, dict):
                    raise ValueError('Expected command object')
                name, phase = body['name'], body.get('phase', 'ready')
                if not isinstance(name, str) or not isinstance(phase, str) or name not in SCENES or phase not in PHASES[name]:
                    raise ValueError('Unknown scenario or phase')
                if not set(body) <= {'name', 'phase', 'userId', 'roomId'}:
                    raise ValueError('Response payloads are not accepted')
                if any(not isinstance(body[key], str) or not body[key] for key in ('userId', 'roomId') if key in body):
                    raise ValueError('Invalid owner')
                if name == 'auto-rebuy' and (not body.get('roomId') or body['roomId'] != self.room_id):
                    raise ValueError('Room must be observed in a real creation response')
                if 'roomId' in body and name != 'auto-rebuy':
                    raise ValueError('This scene has no room parameter')
                if 'userId' in body and self.user_id and self.user_id != body['userId']:
                    raise ValueError('Another user owns this proxy')
                self.gate.set()
                if self.name != name:
                    self.requests = self.held = self.spins = 0
                    self.observed, self.cursors = [], []
                self.name, self.phase = name, phase
                if 'userId' in body:
                    self.user_id = body['userId']
                self.gate = asyncio.Event()
                if phase != 'hold':
                    self.gate.set()
            elif path == '/fixtures/environment' and flow.request.method == 'POST':
                body = flow.request.json()
                if body != {'visual': True}:
                    raise ValueError('Unknown environment')
                self.visual = True
            elif path != '/fixtures/status' or flow.request.method != 'GET':
                raise ValueError('Unknown command')
        except (ValueError, TypeError, KeyError, AttributeError):
            respond(flow, {'error': 'Invalid scenario command'}, 400)
            return
        respond(flow, self.status())

    async def wait(self):
        self.held += 1
        gate = self.gate
        await gate.wait()

    async def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        if flow.response:
            return
        path = urlsplit(flow.request.path).path
        method = flow.request.method
        if self.visual and (flow.request.host == 'freshchat.com' or flow.request.host.endswith('.freshchat.com')):
            if flow.killable:
                flow.kill()
            return
        if self.visual and flow.request.host == 'feedback.userreport.com' and method == 'GET':
            flow.response = http.Response.make(200,
                b'<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
                b'<body style="margin:0;background:#f5f5f5"></body></html>',
                {'Content-Type': 'text/html; charset=utf-8'})
            return
        if not is_staging(flow.request.host) or method == 'OPTIONS':
            return
        if self.visual and re.fullmatch(r'/public/v\d+/user/register/.*', path):
            respond(flow, {'ok': False, 'error': 'fixture_registration_forbidden'}, 403)
            return
        if self.visual and method == 'GET' and path == '/public/v10/profile/country':
            respond(flow, data('country'))
            return
        if self.name == 'launch' and path == '/node/v1/status' and method == 'GET':
            await self.wait()
            return
        if self.name == 'slot' and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)', path):
            respond(flow, self.slot_reply(path))
            return
        if self.name == 'matching' and path in MATCHING_PATHS and method == 'POST':
            self.requests += 1
            result(flow, {})
        elif self.name == 'club-empty' and method == 'GET' and path == '/v10/club' and 'user_id' in parse_qs(urlsplit(flow.request.path).query):
            result(flow, {'clubs': []})
        elif self.name == 'mall' and method == 'GET' and re.fullmatch(r'/v\d+/alipay_order/goods', path):
            respond(flow, data('goods'))
        elif self.name == 'wallet-empty' and self.user_id and method == 'GET' and re.fullmatch(rf'/v11/wallet/{re.escape(self.user_id)}/currency/(coin|diamond)/statement', path):
            result(flow, {'statements': []})
        elif self.name == 'daily-bonus' and method == 'GET' and path == '/v2/check_in/seven_day/rule':
            respond(flow, data('check-in-rule'))
        elif self.name == 'daily-bonus' and method == 'GET' and path == '/v2/check_in/seven_day/current':
            result(flow, [{'check_in_at': datetime.now(timezone.utc).isoformat()}])
        elif self.name == 'invitation' and method == 'PUT' and path == '/v2/building/rooms' and self.house_id:
            try:
                requested = flow.request.json()
            except ValueError:
                return
            if isinstance(requested, dict) and requested.get('building_ids') == [self.house_id]:
                rooms = data('invitation')
                rooms['result'][0].update(building_id=self.house_id, creator_id=self.user_id)
                respond(flow, rooms)
        elif self.name == 'club-skeleton':
            if method == 'GET' and path == '/v10/club' and 'user_id' in parse_qs(urlsplit(flow.request.path).query):
                result(flow, {'clubs': [{'id': club['id']} for club in clubs()]})
            elif method == 'PUT' and path == '/v10/clubs':
                try:
                    requested = flow.request.json()
                except ValueError:
                    return
                if requested == {'club_ids': [club['id'] for club in clubs()]}:
                    self.requests += 1
                    await self.wait()
                    result(flow, clubs())
        elif self.name == 'pagination' and self.user_id and method == 'GET' and re.fullmatch(rf'/v10/buy_in/auditor/{re.escape(self.user_id)}/applications/(pending|processed)', path):
            cursor = parse_qs(urlsplit(flow.request.path).query).get('next_page', [None])[0]
            if path.endswith('/pending'):
                result(flow, {'applications': [], 'next_page': None})
            elif cursor not in (None, 'interaction-page-2'):
                respond(flow, {'error': 'Unknown cursor'}, 400)
            else:
                self.cursors.append(cursor)
                result(flow, {'applications': applications(13, 3) if cursor else applications(1, 12),
                              'next_page': None if cursor else 'interaction-page-2'})
        elif self.name in ('club-error', 'hall-error') and method == 'GET':
            target = (path == '/v10/club' and 'user_id' in parse_qs(urlsplit(flow.request.path).query)
                      if self.name == 'club-error' else path == '/public/v1/hall_matching/available.json')
            if target:
                self.requests += 1
                if self.phase != 'release' and flow.killable:
                    flow.kill()
        elif self.name == 'auto-rebuy' and method == 'PUT' and path in (
                f'/v10/texas_holdem/room/{self.room_id}/user_settings/enable_auto_rebuy',
                f'/v10/texas_holdem/room/{self.room_id}/user_settings/disable_auto_rebuy'):
            self.requests += 1
            await self.wait()
            result(flow, {'auto_rebuy': path.endswith('/enable_auto_rebuy')})

    def response(self, flow):
        if not is_staging(flow.request.host) or not flow.response or flow.response.status_code != 200:
            return
        path = urlsplit(flow.request.path).path
        try:
            body = flow.response.json()
            if body.get('ok') is not True:
                return
            value = body.get('result')
            if flow.request.method == 'GET' and re.fullmatch(r'/v10/house/user/[^/]+', path) and isinstance(value, dict):
                owner = path.rsplit('/', 1)[-1]
                if not self.user_id or self.user_id == owner:
                    self.user_id = owner
                    self.house_id = value.get('house_id', '')
            if flow.request.method == 'POST' and path == '/v3/pay_action/do' and isinstance(value, dict) and not self.room_id:
                request = flow.request.json()
                action, config = request.get('action_url'), request.get('action_json')
                if (isinstance(action, dict) and isinstance(config, dict)
                        and action.get('method') == 'POST'
                        and action.get('path') in ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')
                        and config.get('game_type') in ('texas_holdem', 'texas_react_native')
                        and request.get('user_id') == self.user_id
                        and isinstance(value.get('room_id'), str) and value['room_id']):
                    self.room_id = value['room_id']
        except (ValueError, TypeError, AttributeError):
            return
        if self.name == 'daily-bonus' and self.user_id and flow.request.method == 'PUT' and path == f'/v10/wallet/{self.user_id}':
            def change(wallet):
                currencies = wallet.get('currencies')
                if not isinstance(currencies, list):
                    raise ValueError('Missing currencies')
                for currency in currencies:
                    if currency.get('code') == 'coin':
                        currency['balance'] = '1000'
                return True
            patch_result(flow, change)

    def websocket_message(self, flow):
        if self.name not in ('slot', 'matching') or not is_staging(flow.request.host) or not flow.websocket:
            return
        message = flow.websocket.messages[-1]
        if not message.from_client or not message.is_text or message.injected:
            return
        forward, replies = [], []
        for line in message.text.splitlines():
            try:
                frame = json.loads(line)
                if not isinstance(frame, dict):
                    raise ValueError('Not a command')
                params = frame.get('params') or {}
                payload = params.get('data') or {}
                path = payload.get('path', '')
                if not isinstance(path, str):
                    raise ValueError('Not a path')
            except (ValueError, TypeError, AttributeError):
                forward.append(line)
                continue
            matching = self.name == 'matching' and path in MATCHING_PATHS
            slot = self.name == 'slot' and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)', path)
            if frame.get('method') != 9 or not (matching or slot):
                forward.append(line)
                continue
            answer = {'ok': True, 'result': {}}
            if slot:
                answer = self.slot_reply(path)
            else:
                self.requests += 1
            if 'id' in frame:
                replies.append({'id': frame['id'], 'result': {'data': answer}})
        message.content = '\n'.join(forward).encode()
        if not forward:
            message.drop()
        if replies:
            ctx.master.commands.call('inject.websocket', flow, True,
                                     '\n'.join(json.dumps(reply) for reply in replies).encode(), True)

    def slot_reply(self, path):
        self.requests += 1
        self.observed.append('9:' + re.sub(r'user/[^/]+', 'user/current', path))
        if not self.user_id or not path.startswith(f'/v2/slot_machine/user/{self.user_id}/'):
            return {'ok': False, 'error': 'fixture_owner_mismatch'}
        spin = path.endswith('/spin')
        if spin:
            self.spins += 1
        return self.slot_result(spin)

    def slot_result(self, spin):
        energy = {'user_energy': {'total_energy': 0}, 'energy_factory': {
            'capacity': 50, 'quantity': 50, 'remaining_production_time': '00:00:00'}}
        if spin and self.phase == 'exhausted':
            return {'ok': False, 'error': 'energy_not_enough', 'error_description': 'No energy'}
        if spin:
            currency = self.phase if self.phase in ('coin', 'currency_diamond', 'energy') else 'coin'
            energy = {**copy.deepcopy(energy), 'outcome': [currency] * 3, 'reward': {
                'outcome_pattern': 'three', 'prize': {'coin': 100 if currency == 'coin' else 0,
                'diamond': 5 if currency == 'currency_diamond' else 0, 'energy': 10 if currency == 'energy' else 0}}}
        return {'ok': True, 'result': energy}


addons = [ScenarioFixtures()]
