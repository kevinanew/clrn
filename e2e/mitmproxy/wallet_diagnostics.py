"""流水截图专用只读诊断，保留通用网络代理及夹具行为。"""

from functools import wraps
from urllib.parse import urlsplit
from connection_diagnostics import ConnectionDiagnostics
from network_faults import NetworkFaults, CONTROL_HOST


def isolated(hook):
    """隔离采集错误，禁止诊断异常影响业务流。"""
    @wraps(hook)
    def capture(*args, **kwargs):
        """调用诊断钩子，并在采集失败时保留业务流。"""
        try:
            return hook(*args, **kwargs)
        except Exception:
            return None
    return capture


class WalletDiagnostics(ConnectionDiagnostics):
    """复用现有脱敏字段与有界事件缓冲区。"""


for name in ('request', 'response', 'error', 'server_connect', 'server_connected',
             'server_connect_error', 'server_disconnected', 'websocket_start',
             'websocket_end', 'websocket_message'):
    setattr(WalletDiagnostics, name, isolated(getattr(ConnectionDiagnostics, name)))


diagnostics = WalletDiagnostics()


class WalletNetwork(NetworkFaults):
    """仅增加受原控制令牌保护的诊断快照入口。"""
    async def request(self, flow):
        """业务请求仍交由原代理处理，诊断入口不接受业务流量。"""
        if (flow.request.host == CONTROL_HOST and flow.request.method == 'GET'
                and urlsplit(flow.request.path).path == '/diagnostics'):
            diagnostics.control(flow)
            return
        await super().request(flow)


addons = [WalletNetwork(), diagnostics]
