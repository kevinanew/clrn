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

    def test_probe_transport_stages(self):
        """健康探测复用只读连接阶段，不记录 URL 参数或凭据。"""
        connection = SimpleNamespace(timestamp_start=None, timestamp_tcp_setup=None,
                                     timestamp_tls_setup=None, tls=True)
        flow = SimpleNamespace(request=SimpleNamespace(path='/node/v1/status?token=secret'),
                               server_conn=connection)
        for field, value, expected in (
                ('timestamp_start', None, 'probe-connect-not-started'),
                ('timestamp_start', 1, 'probe-tcp-pending'),
                ('timestamp_tcp_setup', 2, 'probe-tls-pending'),
                ('timestamp_tls_setup', 3, 'probe-transport-ready')):
            setattr(connection, field, value)
            before = vars(connection).copy()
            self.assertEqual(account_connection_fields(flow), {'phase': expected})
            self.assertEqual(vars(connection), before)

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


class RoomConnectionTests(unittest.TestCase):
    """验证建房连接诊断保留真实关联、只读状态和隐私边界。"""

    def test_real_connection_stages(self):
        """flow 占位连接不参与判断，真实钩子按客户端和目标关联。"""
        recorder = RoomConnections()
        client = SimpleNamespace(id='client')
        for path in ('/v3/pay_action/batch/price?token=secret', '/v10/wallet/private-user'):
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
