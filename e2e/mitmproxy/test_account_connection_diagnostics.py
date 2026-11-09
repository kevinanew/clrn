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
