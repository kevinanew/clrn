"""验证入座 RPC 精确隔离、原版网关回复透传及正常恢复的真实命令关联。"""

import asyncio
import hashlib
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from mitmproxy.websocket import WebSocketMessage

with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "unit-control"}):
    from sit_server_errors import SitServerErrors

HOST = "node-0.api.staging.laiwan.shafayouxi.com"
PATH = "/v10/texas_holdem/room/11111111-1111-4111-8111-111111111111/sit"


def command(path=PATH, authorization="owner-secret", method="PUT"):
    """构造真实协议形状，伪凭据只留在测试进程内存。"""
    return {"id": 41, "method": 9, "params": {"data": {
        "path": path, "method": method, "headers": {"Authorization": "Bearer " + authorization},
        "json": {"seat_number": 3}, "params": {},
    }}}


def socket_message(frame, from_client=True, host=HOST):
    """仅隔离网络流，客户端协议和代理路由仍使用实际实现。"""
    message = WebSocketMessage(1, from_client, json.dumps(frame).encode())
    return SimpleNamespace(id="owned-socket", request=SimpleNamespace(host=host),
                           websocket=SimpleNamespace(messages=[message]))


class SitServerErrorsTest(unittest.TestCase):
    """不将其他 RPC、账号、订阅、心跳或注入消息改成故障。"""

    def setUp(self):
        """每例独占代理状态及允许的真实来源配置。"""
        self.enterContext(patch.dict(os.environ, {"MITMPROXY_API_HOSTS": json.dumps([HOST]),
                                                "MITMPROXY_CONTROL_TOKEN": "unit-control"}))
        self.proxy = SitServerErrors()
        self.proxy.set_fault({"status": 503, "format": "json", "path": PATH, "method": "PUT",
                              "userId": "owned-user", "fingerprint": hashlib.sha256(b"owner-secret").hexdigest()})

    def test_only_exact_sit_reaches_gateway_and_reply_is_unchanged(self):
        """客户端收到网关原封装，仅附加原命令编号，不重写业务错误内容。"""
        flow = socket_message(command())
        reply = {"result": {"data": {"ok": False, "error_type": "server_error", "error_message": "服务内部异常"}}}
        result = {"gatewayReply": reply, "upstreamStatus": 503}
        with patch.object(self.proxy, "gateway_reply", return_value=result) as gateway, patch("sit_server_errors.ctx") as context:
            asyncio.run(self.proxy.websocket_message(flow))
        gateway.assert_called_once_with(command()["params"]["data"])
        self.assertTrue(flow.websocket.messages[-1].dropped)
        injected = context.master.commands.call.call_args.args
        self.assertEqual(injected[:3], ("inject.websocket", flow, True))
        self.assertEqual(json.loads(injected[3]), {"id": 41, **reply})
        self.assertEqual(self.proxy.events[-1]["status"], 503)
        self.assertEqual(self.proxy.events[-1]["seat"], 3)
        self.assertNotIn("owner-secret", json.dumps(self.proxy.events))

    def test_v2_gateway_envelope_keeps_status_and_non_json_failure(self):
        """修复版本的协议升级仍原样转交网关信封，不把网关解析失败当作成功。"""
        frame = command()
        frame["params"]["data"]["version"] = "v2"
        flow = socket_message(frame)
        reply = {"result": {"data": {"http_code": 0, "json": {"ok": False, "error_type": "rpc_request_error"}}}}
        with patch.object(self.proxy, "gateway_reply", return_value={"gatewayReply": reply, "upstreamStatus": 503}), \
                patch("sit_server_errors.ctx") as context:
            asyncio.run(self.proxy.websocket_message(flow))
        self.assertEqual(json.loads(context.master.commands.call.call_args.args[3]), {"id": 41, **reply})
        self.assertEqual(self.proxy.events[-1]["gatewayVersion"], "v2")
        self.assertEqual(self.proxy.events[-1]["status"], 503)

    def test_unrelated_protocol_and_scope_pass_through(self):
        """房间、账号、方法、来源不符及订阅心跳都不能命中。"""
        candidates = [socket_message(command(path=PATH.replace("11111111", "22222222"))),
                      socket_message(command(authorization="other")), socket_message(command(method="POST")),
                      socket_message(command(), host="production.invalid"),
                      socket_message({"id": 3, "method": 1, "params": {"channel": "user#owner"}}),
                      socket_message({"id": 4, "method": 7})]
        with patch.object(self.proxy, "gateway_reply") as gateway, patch("sit_server_errors.ctx") as context:
            for flow in candidates:
                asyncio.run(self.proxy.websocket_message(flow))
                self.assertFalse(flow.websocket.messages[-1].dropped)
        gateway.assert_not_called()
        context.master.commands.call.assert_not_called()

    def test_normal_and_recovery_keep_actual_upstream_reply(self):
        """关闭故障后保留原连接回复；不凭空补造旧协议未携带的 HTTP 200。"""
        self.proxy.set_fault({"enabled": False})
        flow = socket_message(command())
        asyncio.run(self.proxy.websocket_message(flow))
        self.assertFalse(flow.websocket.messages[-1].dropped)
        self.assertEqual(self.proxy.events, [])
        reply = {"id": 41, "result": {"data": {"ok": True}}}
        flow.websocket.messages.append(WebSocketMessage(1, False, json.dumps(reply).encode()))
        asyncio.run(self.proxy.websocket_message(flow))
        self.assertEqual(self.proxy.events[-1]["source"], "upstream-rpc")
        self.assertTrue(self.proxy.events[-1]["ok"])
        self.assertIsNone(self.proxy.events[-1]["status"])
        self.assertFalse(flow.websocket.messages[-1].dropped)

    def test_header_case_does_not_change_scope(self):
        """真实请求头大小写变化仍按同一账号指纹匹配。"""
        frame = command()
        headers = frame["params"]["data"]["headers"]
        headers["authorization"] = headers.pop("Authorization")
        self.assertTrue(self.proxy.matches_rpc(socket_message(frame), frame["params"]["data"]))

    def test_injected_replies_are_never_reprocessed(self):
        """代理交回客户端的帧不能再次经过网关或循环注入。"""
        flow = socket_message(command())
        flow.websocket.messages[-1].injected = True
        with patch.object(self.proxy, "gateway_reply") as gateway:
            asyncio.run(self.proxy.websocket_message(flow))
        gateway.assert_not_called()
