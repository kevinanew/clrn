"""验证账户连接诊断只观察传输阶段，不泄露异常或改变请求。"""

import unittest
from types import SimpleNamespace
from account_connection_diagnostics import RoomConnections, account_connection_fields


class AccountConnectionTests(unittest.TestCase):
    """覆盖同轮浏览器成功而独立校验超时所需的连接阶段区分。"""

    def test_transport_stages_and_unrelated_paths(self):
        """只读时间戳；已就绪的浏览器连接与未建连的校验连接必须可区分。"""
        connection = SimpleNamespace(timestamp_start=None, timestamp_tcp_setup=None,
                                     timestamp_tls_setup=None, tls=True)
        flow = SimpleNamespace(request=SimpleNamespace(path='/v11/user/private-user/account'),
                               server_conn=connection)
        for field, value, expected in (
                ('timestamp_start', None, 'account-connect-not-started'),
                ('timestamp_start', 1, 'account-tcp-pending'),
                ('timestamp_tcp_setup', 2, 'account-tls-pending'),
                ('timestamp_tls_setup', 3, 'account-transport-ready')):
            setattr(connection, field, value)
            before = vars(connection).copy()
            self.assertEqual(account_connection_fields(flow), {'phase': expected})
            self.assertEqual(vars(connection), before)
        flow.request.path = '/v10/profile/private-user'
        self.assertEqual(account_connection_fields(flow), {})

    def test_current_failure_scopes_are_read_only_and_redacted(self):
        """本轮四项失败仅增加传输阶段，实体和查询参数不进入诊断。"""
        from account_connection_diagnostics import connection_scope
        for path, scope in (
                ('/v2/check_in/seven_day/rule', 'check-in'),
                ('/v2/check_in/seven_day/current', 'check-in'),
                ('/v10/house/user/private-user', 'house'),
                ('/v3/pay_action/batch/price', 'renewal'),
                ('/v10/wallet/private-user', 'renewal'),
                ('/v10/texas_holdem/room/private-room/profile', 'table'),
                ('/v1/game_log/room/private-room/settlement', 'settlement'),
                ('/v11/game_log/private-user/play_session_record/private-session', 'record'),
                ('/v2/centrifugo/connection/websocket', 'table')):
            self.assertEqual(connection_scope(path + '?token=secret'), scope)
            connection = SimpleNamespace(timestamp_start=1, timestamp_tcp_setup=2,
                                         timestamp_tls_setup=3, tls=True)
            flow = SimpleNamespace(request=SimpleNamespace(path=path), server_conn=connection)
            before = vars(connection).copy()
            self.assertEqual(account_connection_fields(flow), {'phase': scope + '-transport-ready'})
            self.assertEqual(vars(connection), before)
        self.assertIsNone(connection_scope('/v10/profile/private-user'))

    def test_diagnostic_failure_is_contained(self):
        """异常正文不进入诊断，也不传播到请求处理。"""
        class BrokenFlow:
            """模拟采集期间已不可用的流。"""
            @property
            def request(self):
                """抛出含敏感资料的异常。"""
                raise RuntimeError('https://private.invalid/?token=secret')

        self.assertEqual(account_connection_fields(BrokenFlow()),
                         {'phase': 'account-connection-unavailable'})


class AccountLifecycleTests(unittest.TestCase):
    """验证实际钩子连接可与不同的 flow 占位连接关联，且异常隔离。"""
    def test_real_connection_replaces_placeholder_without_leaking_target(self):
        """复现本轮 flow 未建连而真实连接尚不明的诊断缺口。"""
        from account_connection_diagnostics import AccountConnections
        diagnostics = AccountConnections()
        placeholder = SimpleNamespace(timestamp_start=None, timestamp_tcp_setup=None,
                                      timestamp_tls_setup=None, tls=True)
        flow = SimpleNamespace(request=SimpleNamespace(path='/v11/user/private-user/account',
                               host='private.invalid', port=443), server_conn=placeholder,
                               client_conn=SimpleNamespace(id='client-id'))
        diagnostics.observe(flow)
        real = SimpleNamespace(address=('private.invalid', 443), id='actual-connection',
                               timestamp_start=1, timestamp_tcp_setup=2,
                               timestamp_tls_setup=None, tls=True, error='private error with token')
        data = SimpleNamespace(client=flow.client_conn, server=real)
        # 用固定匿名节点标识验证诊断字段不会泄露目标信息。
        fields = diagnostics.fields(data, lambda _: 'anonymous-node')
        self.assertEqual(fields['upstreamConnectionId'], 'actual-connection')
        self.assertEqual(fields['phase'], 'account-hook-tls-pending')
        self.assertEqual(account_connection_fields(flow), {'phase': 'account-connect-not-started'})
        self.assertNotIn('private', str(fields))
        real.address = ('unrelated.invalid', 443)
        # 无关地址使用固定匿名节点标识，不应匹配已观察的目标。
        self.assertIsNone(diagnostics.fields(data, lambda _: 'anonymous-node'))
        # 空上下文使用固定匿名节点标识，也不应产生诊断字段。
        self.assertIsNone(diagnostics.fields(None, lambda _: 'anonymous-node'))

    def test_bounded_associations_and_broken_observation(self):
        """大量上下文仍保持上限，诊断读取异常不向调用者传播。"""
        from account_connection_diagnostics import AccountConnections
        diagnostics = AccountConnections()
        diagnostics.observe(None)
        for index in range(1001):
            flow = SimpleNamespace(request=SimpleNamespace(path='/v11/user/private/account',
                                   host='private.invalid', port=443), server_conn=SimpleNamespace(timestamp_start=None),
                                   client_conn=SimpleNamespace(id=str(index)))
            diagnostics.observe(flow)
        self.assertEqual(len(diagnostics.targets), 1000)


class TableLifecycleTests(unittest.TestCase):
    """选线成功与独立连接失败可同时发生，必须观察实际连接而非推断全网故障。"""
    def test_table_paths_and_real_connection_stages(self):
        """只对白名单接口采集，验证匿名关联、阶段及只读属性。"""
        from account_connection_diagnostics import AccountConnections
        diagnostics = AccountConnections()
        for path in ('/node/v1/status', '/public/v12/metadata/servers',
                     '/public/v13/metadata/servers', '/v2/centrifugo/connection/websocket'):
            connection = SimpleNamespace(address=('private.invalid', 443), id='real-id',
                                         timestamp_start=1, timestamp_tcp_setup=None,
                                         timestamp_tls_setup=None, tls=True, error=None)
            flow = SimpleNamespace(request=SimpleNamespace(path=path, host='private.invalid', port=443),
                                   client_conn=SimpleNamespace(id='client-id'), server_conn=connection)
            diagnostics.observe(flow)
            data = SimpleNamespace(client=flow.client_conn, server=connection)
            for field, value, phase in (('timestamp_start', 1, 'tcp-pending'),
                                        ('timestamp_tcp_setup', 2, 'tls-pending'),
                                        ('timestamp_tls_setup', 3, 'transport-ready')):
                setattr(connection, field, value)
                before = vars(connection).copy()
                # 用固定匿名节点标识验证各连接阶段不会泄露目标信息。
                fields = diagnostics.fields(data, lambda _: 'anonymous-node')
                self.assertEqual(fields['phase'], 'table-hook-' + phase)
                self.assertNotIn('private', str(fields))
                self.assertEqual(vars(connection), before)
            self.assertEqual(account_connection_fields(flow), {'phase': 'table-transport-ready'})


class RoomConnectionTests(unittest.TestCase):
    """验证建房连接诊断保留真实关联、只读状态和隐私边界。"""

    def test_real_connection_stages(self):
        """flow 占位连接不参与判断，真实钩子按客户端和目标关联。"""
        recorder = RoomConnections()
        client = SimpleNamespace(id='client')
        for path in ('/v1/game_log/room/game_amount?token=secret',
                     '/v3/pay_action/batch/price?token=secret',
                     '/v10/texas_holdem/room/00000000-0000-4000-8000-000000000001/user_settings?token=secret'):
            flow = SimpleNamespace(client_conn=client, request=SimpleNamespace(
                path=path, host='private.invalid', port=443))
            recorder.observe(flow)
            server = SimpleNamespace(id='real-server', address=('private.invalid', 443),
                                     timestamp_start=None, timestamp_tcp_setup=None,
                                     timestamp_tls_setup=None, tls=True, error=None)
            data = SimpleNamespace(client=client, server=server)
            for field, value, phase in (
                    ('timestamp_start', None, 'connect-not-started'),
                    ('timestamp_start', 1, 'tcp-pending'),
                    ('timestamp_tcp_setup', 2, 'tls-pending'),
                    ('timestamp_tls_setup', 3, 'transport-ready')):
                setattr(server, field, value)
                before = vars(server).copy()
                # 用固定匿名标识验证连接阶段字段，不暴露真实节点信息。
                result = recorder.fields(data, lambda _: 'anonymous-node')
                self.assertEqual(result['phase'], 'room-hook-' + phase)
                self.assertEqual(result['upstreamConnectionId'], 'real-server')
                self.assertNotIn('private', str(result))
                self.assertEqual(vars(server), before)
            server.address = ('other.invalid', 443)
            # 用固定匿名标识验证非目标地址不会产生诊断字段。
            self.assertIsNone(recorder.fields(data, lambda _: 'anonymous-node'))

    def test_unrelated_and_broken_connections_are_ignored(self):
        """白名单之外无采集，诊断失败不传播或泄露错误正文。"""
        recorder = RoomConnections()
        flow = SimpleNamespace(client_conn=SimpleNamespace(id='client'), request=SimpleNamespace(
            path='/v10/profile/private-user', host='private.invalid', port=443))
        recorder.observe(flow)
        recorder.observe(None)
        self.assertEqual(recorder.targets, {})
        # 用固定匿名标识验证空连接不会产生诊断字段。
        self.assertIsNone(recorder.fields(None, lambda _: 'anonymous-node'))
