"""验证 5xx 注入的完整范围、精确隔离和解除后的透传。"""

import asyncio
import hashlib
import json
import os
import unittest
from unittest.mock import patch

from mitmproxy import connection, http

with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
    from server_errors import ServerErrors

PATH = "/v10/texas_holdem/room/11111111-1111-4111-8111-111111111111/buy_in/apply"
HOST = "node-0.api.staging.laiwan.shafayouxi.com"


def application_flow(path=PATH, token="owner", method="POST", host=HOST):
    """创建真实 mitmproxy HTTP 流，只在网络边界隔离应用。"""
    flow = http.HTTPFlow(
        connection.Client(peername=("127.0.0.1", 12345), sockname=("127.0.0.1", 8080)),
        connection.Server(address=(host, 443)), live=True,
    )
    flow.request = http.Request.make(method, f"https://{host}{path}", b"{}")
    flow.request.headers["Authorization"] = f"Bearer {token}"
    return flow


def configuration(status=503, response_format="json"):
    """绑定本轮接口和账号；管理指纹不进入代理事件。"""
    return {"status": status, "format": response_format, "path": PATH, "method": "POST",
            "fingerprint": hashlib.sha256(b"owner").hexdigest()}


class ServerErrorsTest(unittest.TestCase):
    """确保所有新增应用 API 模拟都只返回 500–599。"""

    def setUp(self):
        """每例建立未启用的独立代理状态。"""
        self.enterContext(patch.dict(os.environ, {"MITMPROXY_API_HOSTS": json.dumps([HOST])}))
        with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
            self.proxy = ServerErrors()

    def test_every_5xx_status_and_format(self):
        """逐一确认 100 个 5xx 状态和 JSON／HTML 格式原样返回。"""
        for status in range(500, 600):
            for response_format in ("json", "html"):
                with self.subTest(status=status, response_format=response_format):
                    self.proxy.set_fault(configuration(status, response_format))
                    flow = application_flow()
                    asyncio.run(self.proxy.request(flow))
                    self.assertEqual(flow.response.status_code, status)
                    self.assertIn(str(status), flow.response.text)
                    self.assertNotIn("owner", json.dumps(self.proxy.events))

    def test_rejects_non_5xx_without_changing_active_scope(self):
        """非法状态不能替换已启用的 503 故障。"""
        self.proxy.set_fault(configuration())
        for status in (200, 400, 499, 600, 601, "503", 503.0, True, None):
            with self.subTest(status=status), self.assertRaises(ValueError):
                self.proxy.set_fault(configuration(status))
        self.assertEqual(self.proxy.scope["status"], 503)

    def test_unrelated_requests_and_preflight_pass_through(self):
        """其他房间、账号、方法、来源和初始化请求均不被注入。"""
        self.proxy.set_fault(configuration())
        candidates = [application_flow(path=PATH.replace("11111111", "22222222")),
                      application_flow(token="another"), application_flow(method="OPTIONS"),
                      application_flow(host="api.production.invalid"),
                      application_flow(path="/v11/user/owner/account")]
        for flow in candidates:
            asyncio.run(self.proxy.request(flow))
            self.assertIsNone(flow.response)
        self.assertEqual(self.proxy.events, [])

    def test_clear_observes_real_upstream(self):
        """清除故障后不生成成功数据，只记录真实返回。"""
        self.proxy.set_fault(configuration())
        self.proxy.set_fault({"enabled": False})
        flow = application_flow()
        asyncio.run(self.proxy.request(flow))
        self.assertIsNone(flow.response)
        flow.response = http.Response.make(201, b"real upstream")
        self.proxy.response(flow)
        self.assertEqual(self.proxy.events[-1]["source"], "upstream")
        self.assertEqual(self.proxy.events[-1]["status"], 201)

    def test_control_requires_authentication(self):
        """未经认证的本机管理请求不能开启故障。"""
        flow = application_flow(path="/server-errors", host="test-mitmproxy.invalid")
        flow.request.content = json.dumps(configuration()).encode()
        asyncio.run(self.proxy.request(flow))
        self.assertEqual(flow.response.status_code, 403)
        self.assertFalse(self.proxy.enabled)

    def test_control_fault_retries_and_recovery_keep_ordered_evidence(self):
        """正常对照透传；换准确房间注入后，证据保留正常、两次 5xx 和真实恢复。"""
        self.proxy.set_fault({**configuration(), "enabled": False})
        control = application_flow()
        asyncio.run(self.proxy.request(control))
        self.assertIsNone(control.response)
        control.response = http.Response.make(200, b"upstream control")
        self.proxy.response(control)
        fault_path = PATH.replace("11111111", "22222222")
        self.proxy.set_fault({**configuration(), "path": fault_path})
        for _ in range(2):
            flow = application_flow(path=fault_path)
            asyncio.run(self.proxy.request(flow))
            self.assertEqual(flow.response.status_code, 503)
        self.proxy.set_fault({"enabled": False})
        recovered = application_flow(path=fault_path)
        asyncio.run(self.proxy.request(recovered))
        self.assertIsNone(recovered.response)
        recovered.response = http.Response.make(200, b"upstream recovery")
        self.proxy.response(recovered)
        self.assertEqual([(event["path"], event["source"], event["status"])
                          for event in self.proxy.events], [
            (PATH, "upstream", 200), (fault_path, "injected-5xx", 503),
            (fault_path, "injected-5xx", 503), (fault_path, "upstream", 200),
        ])
        self.assertEqual(len({event["requestId"] for event in self.proxy.events}), 4)
        self.assertNotIn("fingerprint", json.dumps(self.proxy.events))

    def test_rejects_invalid_observation_switch(self):
        """仅观察模式必须显式使用布尔值，非法配置不得改变已有故障。"""
        self.proxy.set_fault(configuration())
        for enabled in (None, 0, 1, "false"):
            with self.subTest(enabled=enabled), self.assertRaises(ValueError):
                self.proxy.set_fault({**configuration(), "enabled": enabled})
        self.assertTrue(self.proxy.enabled)
