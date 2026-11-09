"""验证账户连接诊断只观察传输阶段，不泄露异常或改变请求。"""

import unittest
from types import SimpleNamespace
from account_connection_diagnostics import account_connection_fields


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
