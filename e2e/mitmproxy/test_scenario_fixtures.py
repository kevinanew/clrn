"""共用夹具的透传、控制认证、写隔离和迁移前协议回归，不访问真实服务。"""

import asyncio
import copy
import json
import unittest
from unittest.mock import patch

from mitmproxy import http, websocket
from wsproto.frame_protocol import Opcode
from test_network_faults import flow

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from scenario_fixtures import ScenarioFixtures

HOST = 'https://api.shafayouxi.org'
SELF = '33333333-3333-4333-8333-333333333333'
OTHER = '22222222-2222-4222-8222-222222222222'
ROOM = '11111111-1111-4111-8111-111111111111'


class ScenarioFixtureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = ScenarioFixtures()

    async def control(self, body, token='test-token', path='select'):
        request = flow(f'http://fixtures-mitmproxy.invalid/fixtures/{path}', 'POST',
                       json.dumps(body).encode(), token)
        await self.addon.request(request)
        return request.response.status_code

    async def request(self, path, method='GET', body=None, origin=HOST):
        request = flow(origin + path, method, b'' if body is None else json.dumps(body).encode())
        await self.addon.request(request)
        return request

    async def test_私人房资料的真实读取方法绑定归属且不修改上游响应(self):
        for method in ('GET', 'PUT'):
            with self.subTest(method=method):
                self.setUp()
                house = await self.request(f'/v10/house/user/{SELF}', method)
                original = {'ok': True, 'result': {'house_id': ROOM, 'user_id': SELF}, 'new_field': 42}
                for status, body in ((503, original), (200, {'ok': False}), (200, original)):
                    house.response = http.Response.make(status, json.dumps(body).encode())
                    before = house.response.content
                    self.addon.response(house)
                    self.assertEqual(house.response.content, before, '绑定归属时必须保留真实房屋资料')
                    self.assertEqual(self.addon.user_id, SELF if status == 200 and body.get('ok') else '')
                foreign = await self.request(f'/v10/house/user/{OTHER}', method)
                foreign.response = http.Response.make(200, json.dumps(original).encode())
                self.addon.response(foreign)
                self.assertEqual((self.addon.user_id, self.addon.house_id), (SELF, ROOM),
                                 '其他账号资料不能改变当前代理归属')

    async def test_default_and_unmatched_traffic_passes_including_initialization(self):
        paths = ['/public/v12/metadata/servers', '/public/v13/metadata/servers', '/node/v1/status',
                 '/public/v11/user/login', f'/v11/user/{SELF}/account', f'/v10/wallet/{SELF}',
                 '/v2/room/disallow-rule/reminder', '/public/v1/hall_matching/available.json']
        for scene in ('none', 'mall', 'slot', 'daily-bonus', 'club-empty'):
            await self.control({'name': scene})
            for path in paths:
                request = await self.request(path)
                self.assertIsNone(request.response, (scene, path))
                self.assertIsNone(request.error, (scene, path))
            for origin, method in (('https://production.example', 'GET'),
                                   ('https://api.shafayouxi.org.evil.test', 'GET'), (HOST, 'OPTIONS')):
                request = await self.request('/v1/alipay_order/goods', method, origin=origin)
                self.assertIsNone(request.response)

    async def test_control_rejects_payloads_invalid_phases_and_other_owner_atomically(self):
        self.assertEqual(await self.control({'name': 'slot', 'userId': SELF}), 200)
        for body in (None, [], {}, {'name': []}, {'name': 'unknown'}, {'name': 'slot', 'phase': []},
                     {'name': 'slot', 'phase': 'hold'}, {'name': 'slot', 'result': {}},
                     {'name': 'none', 'userId': OTHER}, {'name': 'slot', 'roomId': ROOM}):
            with self.subTest(body=body):
                self.assertEqual(await self.control(body), 400)
                self.assertEqual((self.addon.name, self.addon.user_id), ('slot', SELF))
        self.assertEqual(await self.control({'name': 'none'}, token='wrong'), 403)
        self.assertEqual(self.addon.name, 'slot')

    async def test_environment_is_explicit_and_keeps_real_login_health_and_options(self):
        self.assertIsNone((await self.request('/public/v10/profile/country')).response)
        self.assertEqual(await self.control({'visual': True}, path='environment'), 200)
        country = await self.request('/public/v10/profile/country')
        self.assertEqual(country.response.json(), {'ok': True, 'result': {'countryPhoneCode': '86'}})
        self.assertEqual((await self.request('/public/v11/user/register/test', 'POST')).response.status_code, 403)
        self.assertIsNone((await self.request('/public/v11/user/login', 'POST')).response)
        self.assertIsNone((await self.request('/node/v1/status')).response)
        self.assertIsNone((await self.request('/public/v10/profile/country', 'OPTIONS')).response)
        chat = await self.request('/widget', origin='https://wchat.freshchat.com')
        self.assertIsNotNone(chat.error)
        feedback = await self.request('/', origin='https://feedback.userreport.com')
        self.assertIn(b'<!DOCTYPE html>', feedback.response.content)
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            fresh = ScenarioFixtures()
        self.assertFalse(fresh.visual)
        self.assertEqual(fresh.name, 'none')

    async def test_pagination_keeps_cursor_order_and_terminal_page(self):
        await self.control({'name': 'pagination', 'userId': SELF})
        base = f'/v10/buy_in/auditor/{SELF}/applications/'
        pending = await self.request(base + 'pending')
        first = await self.request(base + 'processed')
        second = await self.request(base + 'processed?next_page=interaction-page-2')
        self.assertEqual(pending.response.json()['result']['applications'], [])
        self.assertEqual(len(first.response.json()['result']['applications']), 12)
        self.assertEqual(second.response.json()['result']['next_page'], None)
        self.assertEqual([row['nickname'] for row in second.response.json()['result']['applications']],
                         ['滚动玩家13', '滚动玩家14', '滚动玩家15'])
        self.assertEqual(self.addon.cursors, [None, 'interaction-page-2'])
        self.assertEqual((await self.request(base + 'processed?next_page=unexpected')).response.status_code, 400)
        self.assertIsNone((await self.request(base + 'processed', 'POST')).response)
        self.assertIsNone((await self.request(base.replace(SELF, OTHER) + 'processed')).response)

    async def test_wallet_empty_only_matches_selected_users_read_statement(self):
        await self.control({'name': 'wallet-empty', 'userId': SELF})
        path = f'/v11/wallet/{SELF}/currency/coin/statement'
        self.assertEqual((await self.request(path)).response.json()['result'], {'statements': []})
        self.assertIsNone((await self.request(path.replace(SELF, OTHER))).response)
        self.assertIsNone((await self.request(path, 'POST')).response)
        self.assertIsNone((await self.request(f'/v10/wallet/{SELF}', 'PUT')).response)

    async def test_fault_release_reissues_real_request_instead_of_fake_success(self):
        for scene, path in (('club-error', f'/v10/club?user_id={SELF}'),
                            ('hall-error', '/public/v1/hall_matching/available.json')):
            await self.control({'name': scene})
            failed = await self.request(path)
            self.assertIsNotNone(failed.error)
            await self.control({'name': scene, 'phase': 'release'})
            recovered = await self.request(path)
            self.assertIsNone(recovered.response)
            self.assertIsNone(recovered.error)
            self.assertEqual(self.addon.requests, 2)

    async def test_launch_hold_releases_without_replacing_health_response(self):
        await self.control({'name': 'launch', 'phase': 'hold'})
        task = asyncio.create_task(self.request('/node/v1/status'))
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertEqual(self.addon.held, 1)
        self.assertIsNone((await self.request('/public/v13/metadata/servers')).response)
        await self.control({'name': 'launch', 'phase': 'release'})
        self.assertIsNone((await asyncio.wait_for(task, 1)).response)

    async def test_daily_bonus_only_changes_own_coin_after_successful_upstream(self):
        await self.control({'name': 'daily-bonus', 'userId': SELF})
        original = {'ok': True, 'new_envelope': 42, 'result': {'id': 'real-wallet', 'currencies': [
            {'code': 'coin', 'balance': '0'}, {'code': 'diamond', 'balance': '60'}]}}
        request = await self.request(f'/v10/wallet/{SELF}', 'PUT')
        self.assertIsNone(request.response)
        expected = copy.deepcopy(original)
        expected['result']['currencies'][0]['balance'] = '1000'
        request.response = http.Response.make(200, json.dumps(original).encode(), {'X-Upstream': 'kept'})
        self.addon.response(request)
        self.assertEqual(request.response.json(), expected)
        self.assertEqual(request.response.headers['X-Upstream'], 'kept')
        for status, body in ((401, original), (200, {'ok': False, 'error': 'invalid_session'}),
                             (200, {'ok': True, 'result': []})):
            request.response = http.Response.make(status, json.dumps(body).encode())
            before = request.response.content
            self.addon.response(request)
            self.assertEqual(request.response.content, before)
        other = await self.request(f'/v10/wallet/{OTHER}', 'PUT')
        other.response = http.Response.make(200, json.dumps(original).encode())
        self.addon.response(other)
        self.assertEqual(other.response.json(), original)

    async def test_auto_rebuy_requires_successful_creation_and_never_forwards_owned_write(self):
        await self.control({'name': 'none', 'userId': SELF})
        self.assertEqual(await self.control({'name': 'auto-rebuy', 'roomId': ROOM}), 400)
        body = {'user_id': SELF, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
                'action_json': {'game_type': 'texas_react_native'}}
        for request_body, ok in ((dict(body, user_id=OTHER), True), (body, False),
                                  (dict(body, action_json={'game_type': 'zhajinhua'}), True), (body, True)):
            creation = await self.request('/v3/pay_action/do', 'POST', request_body)
            self.assertIsNone(creation.response)
            creation.response = http.Response.make(200, json.dumps({'ok': ok, 'result': {'room_id': ROOM}}).encode())
            self.addon.response(creation)
        self.assertEqual(self.addon.room_id, ROOM)
        await self.control({'name': 'auto-rebuy', 'roomId': ROOM, 'phase': 'hold'})
        self.assertEqual(await self.control({'name': 'auto-rebuy', 'roomId': OTHER}), 400)
        path = f'/v10/texas_holdem/room/{ROOM}/user_settings/enable_auto_rebuy'
        held = asyncio.create_task(self.request(path, 'PUT'))
        await asyncio.sleep(0)
        self.assertFalse(held.done())
        self.assertIsNone((await self.request(path.replace(ROOM, OTHER), 'PUT')).response)
        await self.control({'name': 'auto-rebuy', 'roomId': ROOM, 'phase': 'release'})
        self.assertEqual((await held).response.json(), {'ok': True, 'result': {'auto_rebuy': True}})
        # release 只释放等待，不能把隔离写操作改成透传。
        self.assertIsNotNone((await self.request(path, 'PUT')).response)
        disabled = await self.request(path.replace('enable_auto_rebuy', 'disable_auto_rebuy'), 'PUT')
        self.assertEqual(disabled.response.json()['result'], {'auto_rebuy': False})

    async def test_邀请面板只替换本人房屋的确切批次且保留真实资料(self):
        await self.control({'name': 'invitation', 'userId': SELF})
        path = '/v2/building/rooms'
        self.assertIsNone((await self.request(path, 'PUT', {'building_ids': [ROOM]})).response)
        house = await self.request(f'/v10/house/user/{SELF}', 'PUT')
        original = {'ok': True, 'result': {'house_id': ROOM, 'house_number': 123, 'user_id': SELF}}
        house.response = http.Response.make(200, json.dumps(original).encode())
        self.addon.response(house)
        self.assertEqual(house.response.json(), original)
        rooms = await self.request(path, 'PUT', {'building_ids': [ROOM]})
        room = rooms.response.json()['result'][0]
        self.assertEqual((room['building_id'], room['creator_id']), (ROOM, SELF))
        self.assertEqual(room['room_name'], 'TestRoom')
        for method, body in (('GET', None), ('POST', {'building_ids': [ROOM]}),
                             ('PUT', {'building_ids': [OTHER]}), ('PUT', {'building_ids': [ROOM, OTHER]})):
            self.assertIsNone((await self.request(path, method, body)).response)

    async def test_slot_isolates_unbound_and_foreign_http_spins(self):
        await self.control({'name': 'slot'})
        path = f'/v2/slot_machine/user/{SELF}/spin'
        self.assertFalse((await self.request(path, 'POST')).response.json()['ok'])
        await self.control({'name': 'slot', 'userId': SELF, 'phase': 'currency_diamond'})
        spin = await self.request(path, 'POST')
        self.assertEqual(spin.response.json()['result']['reward']['prize']['diamond'], 5)
        self.assertFalse((await self.request(path.replace(SELF, OTHER), 'POST')).response.json()['ok'])
        await self.control({'name': 'slot', 'phase': 'exhausted'})
        self.assertEqual((await self.request(path, 'POST')).response.json()['error'], 'energy_not_enough')

    async def test_websocket_mixed_batch_preserves_subscription_ping_and_reply_order(self):
        await self.control({'name': 'slot', 'userId': SELF})
        socket = flow(HOST + '/connection/websocket')
        socket.websocket = websocket.WebSocketData()
        ping = {'id': 1, 'method': 7}
        subscription = {'id': 2, 'method': 1, 'params': {'channel': 'real-room'}}
        rpc = {'id': 3, 'method': 9, 'params': {'data': {'path': f'/v2/slot_machine/user/{SELF}/energy'}}}
        spin = {**rpc, 'id': 4, 'params': {'data': {'path': f'/v2/slot_machine/user/{SELF}/spin'}}}
        # 损坏和非业务行也不应导致整个批次被吞掉或危险操作透传。
        lines = [json.dumps(item) for item in (ping, subscription, rpc, spin)] + ['invalid', '[]']
        message = websocket.WebSocketMessage(Opcode.TEXT, True, '\n'.join(lines).encode())
        socket.websocket.messages.append(message)
        with patch('scenario_fixtures.ctx.master', create=True) as master:
            self.addon.websocket_message(socket)
            args = master.commands.call.call_args.args
        self.assertEqual(message.text.splitlines(), [json.dumps(ping), json.dumps(subscription), 'invalid', '[]'])
        self.assertEqual(args[:3], ('inject.websocket', socket, True))
        replies = [json.loads(line) for line in args[3].decode().splitlines()]
        self.assertEqual([reply['id'] for reply in replies], [3, 4])
        self.assertEqual(self.addon.spins, 1)
        message.injected = True
        before = message.content
        self.addon.websocket_message(socket)
        self.assertEqual(message.content, before)

    async def test_matching_isolates_http_and_websocket_writes(self):
        await self.control({'name': 'matching'})
        for path in ('/v1/hall_matching/join', '/v1/hall_matching/quit', '/v1/hall_matching/keep_waiting'):
            self.assertEqual((await self.request(path, 'POST')).response.json(), {'ok': True, 'result': {}})
            socket = flow(HOST + '/connection/websocket')
            socket.websocket = websocket.WebSocketData()
            message = websocket.WebSocketMessage(Opcode.TEXT, True, json.dumps({
                'id': 10, 'method': 9, 'params': {'data': {'path': path, 'method': 'POST'}}}).encode())
            socket.websocket.messages.append(message)
            with patch('scenario_fixtures.ctx.master', create=True) as master:
                self.addon.websocket_message(socket)
                self.assertTrue(message.dropped)
                self.assertTrue(json.loads(master.commands.call.call_args.args[3])['result']['data']['ok'])
        self.assertEqual(self.addon.requests, 6)


if __name__ == '__main__':
    unittest.main()
