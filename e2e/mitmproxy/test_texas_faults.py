"""验证修复前代理的账号与房间隔离、协议关联、解除故障及凭据脱敏。"""

import hashlib
import json
import os
import unittest
from unittest.mock import patch

from mitmproxy import http
from mitmproxy.websocket import WebSocketData, WebSocketMessage
from test_network_faults import flow, source_environment

with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
    from texas_faults import TexasFaults

ROOM = "94000000-0000-4000-8000-000000000001"
AUTHORIZATION = "Bearer private-test-session"


class TexasFaultTests(unittest.IsolatedAsyncioTestCase):
    """离线工具自测；不调用 staging，不依赖应用已经修复。"""

    def setUp(self):
        self.enterContext(source_environment())
        with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
            self.addon = TexasFaults()

    async def configure(self, mode, token="test-token", **overrides):
        """通过真实控制请求设置范围，不绕过认证或配置校验。"""
        body = {
            "roomId": ROOM,
            "mode": mode,
            "fingerprint": hashlib.sha256(b"private-test-session").hexdigest(),
            **overrides,
        }
        request = flow(
            "http://test-mitmproxy.invalid/texas",
            "POST",
            json.dumps(body).encode(),
            token,
        )
        await self.addon.request(request)
        return request

    def socket(
        self, commands, host="node-0.service.invalid", from_client=True, injected=False
    ):
        """构造多命令文本帧，保留无关命令以检查透传。"""
        request = flow(f"https://{host}/connection/websocket")
        request.websocket = WebSocketData()
        message = WebSocketMessage(
            1,
            from_client,
            "\n".join(json.dumps(item) for item in commands).encode(),
            injected=injected,
        )
        request.websocket.messages.append(message)
        return request, message

    def command(self, identifier=7, room=ROOM, authorization=AUTHORIZATION):
        """使用与实际客户端相同的 Centrifuge method=9 信封。"""
        return {
            "id": identifier,
            "method": 9,
            "params": {
                "data": {
                    "path": f"/v10/texas_holdem/room/{room}/sit",
                    "method": "PUT",
                    "headers": {"Authorization": authorization},
                    "json": {"seat_number": 1},
                }
            },
        }

    async def test_control_requires_authentication_and_valid_scope(self):
        """未知场景、缺失凭据和无效房间不能开启注入。"""
        self.assertEqual(
            (await self.configure("missing-fields", "wrong")).response.status_code, 403
        )
        self.assertEqual(
            (await self.configure("player_not_enough_stack")).response.status_code, 400
        )
        self.assertEqual(
            (await self.configure("timeout", roomId="not-a-room")).response.status_code,
            400,
        )
        self.assertIsNone(self.addon.target)

    async def test_only_exact_room_account_and_node_are_affected(self):
        """同节点其他账号、其他房间及未登记主机完全透传。"""
        await self.configure("timeout")
        cases = [
            (
                [self.command(authorization="Bearer other-session")],
                "node-0.service.invalid",
            ),
            (
                [self.command(room="94000000-0000-4000-8000-000000000009")],
                "node-0.service.invalid",
            ),
            ([self.command()], "unconfigured.invalid"),
        ]
        for commands, host in cases:
            request, message = self.socket(commands, host)
            before = message.content
            self.addon.websocket_message(request)
            self.assertFalse(message.dropped)
            self.assertEqual(message.content, before)
        self.assertFalse(
            any(item["direction"] == "request" for item in self.addon.timeline)
        )

    async def test_missing_fields_preserves_command_id_and_other_commands(self):
        """异常响应保留关联编号；同帧心跳不被删除，不注入余额不足。"""
        await self.configure("missing-fields")
        heartbeat = {"id": 8, "method": 7}
        request, message = self.socket([self.command(), heartbeat])
        with patch("texas_faults.ctx") as context:
            self.addon.websocket_message(request)
            reply = context.master.commands.call.call_args.args[3]
        self.assertEqual(
            json.loads(reply), {"id": 7, "result": {"data": {"ok": False}}}
        )
        self.assertEqual(json.loads(message.text), heartbeat)
        self.assertNotIn("private-test-session", json.dumps(self.addon.timeline))

    async def test_bearer_scheme_case_does_not_change_scope(self):
        """Bearer 大小写遵循认证协议，不能造成漏命中或跨账号命中。"""
        await self.configure("timeout")
        request, message = self.socket(
            [self.command(authorization="bearer private-test-session")]
        )
        self.addon.websocket_message(request)
        self.assertTrue(message.dropped)
        self.assertEqual(self.addon.timeline[-1]["direction"], "request")

    async def test_clearing_fault_forwards_request_and_correlates_real_reply(self):
        """清除后真实命令发给上游，回复只和同连接的命令编号关联。"""
        await self.configure("timeout")
        request, _ = self.socket([self.command()])
        self.addon.websocket_message(request)
        await self.configure("none")
        recovered, outgoing = self.socket([self.command(9)])
        self.addon.websocket_message(recovered)
        self.assertFalse(outgoing.dropped)
        reply = {"id": 9, "result": {"data": {"ok": True}}}
        recovered.websocket.messages.append(
            WebSocketMessage(1, False, json.dumps(reply).encode())
        )
        self.addon.websocket_message(recovered)
        self.assertEqual(self.addon.timeline[-1]["direction"], "upstream-response")
        self.assertTrue(self.addon.timeline[-1]["ok"])

    async def test_injected_messages_are_not_processed_again(self):
        """注入的回复不应被当成真实上游回复。"""
        await self.configure("missing-fields")
        request, _message = self.socket(
            [self.command()], from_client=False, injected=True
        )
        self.addon.websocket_message(request)
        self.assertEqual(self.addon.timeline, [])

    async def test_http_statuses_are_real_http_responses(self):
        """503/504 保留 HTTP 状态，不注入 WebSocket 或余额不足业务信封。"""
        for mode in ("http-503", "http-504"):
            await self.configure(mode, operation="buy-in")
            request = flow(
                f"https://node-0.service.invalid/v10/texas_holdem/room/{ROOM}/buy_in/apply",
                "POST",
            )
            request.request.headers["Authorization"] = AUTHORIZATION
            await self.addon.request(request)
            self.assertEqual(request.response.status_code, int(mode[-3:]))
            self.assertEqual(request.response.json(), {"ok": False})
            self.assertEqual(self.addon.timeline[-1]["layer"], "http")
        self.assertEqual((await self.configure("http-503")).response.status_code, 400)

    async def test_http_preflight_other_accounts_and_clearing(self):
        """放行预检和其他账号；解除故障后关联实际 HTTP 上游回复。"""
        await self.configure("http-503", operation="buy-in")
        url = (
            f"https://node-0.service.invalid/v10/texas_holdem/room/{ROOM}/buy_in/apply"
        )
        for method, authorization in (
            ("OPTIONS", AUTHORIZATION),
            ("POST", "Bearer other-session"),
        ):
            request = flow(url, method)
            request.request.headers["Authorization"] = authorization
            await self.addon.request(request)
            self.assertIsNone(request.response)
            self.assertIsNone(request.error)
        await self.configure("none", operation="buy-in")
        request = flow(url, "POST")
        request.request.headers["Authorization"] = AUTHORIZATION
        await self.addon.request(request)
        self.assertIsNone(request.response)
        request.response = http.Response.make(200, b'{"ok": true}')
        self.addon.response(request)
        self.assertEqual(self.addon.timeline[-1]["direction"], "upstream-response")
        self.assertTrue(self.addon.timeline[-1]["ok"])
