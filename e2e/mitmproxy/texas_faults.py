"""修复前定向故障：只命中本轮账号的准确房间及入座 RPC，其他流量透传。"""

import asyncio
import hashlib
import json
import re
import time
from urllib.parse import urlsplit

from mitmproxy import ctx, http
from network_faults import NetworkFaults, json_response
from response_overrides import is_staging
from scenario_fixtures import parse_websocket_command

MODES = (
    "none",
    "timeout",
    "disconnect",
    "missing-fields",
    "invalid-json",
    "business-conflict",
    "http-503",
    "http-504",
)


class TexasFaults(NetworkFaults):
    """复用认证控制和生命周期，不伪造余额不足或站起推送。"""

    def __init__(self):
        super().__init__()
        self.target = None
        self.mode = "none"
        self.fingerprint = None
        self.timeline = []
        self.pending = {}
        self.transport = "websocket"
        self.method = "PUT"

    def control(self, flow):
        """配置准确作用域并返回白名单时间线，控制凭据不进入浏览器。"""
        if urlsplit(flow.request.path).path != "/texas":
            super().control(flow)
            return
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        if flow.request.method == "POST":
            try:
                body = json.loads(flow.request.content)
                room = body["roomId"]
                mode = body["mode"]
                fingerprint = body["fingerprint"]
                operation = body.get("operation", "sit")
                if (
                    not re.fullmatch(
                        r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", room
                    )
                    or mode not in MODES
                    or not re.fullmatch(r"[a-f0-9]{64}", fingerprint)
                    or operation not in ("sit", "buy-in")
                    or (operation == "sit" and mode.startswith("http-"))
                ):
                    raise ValueError("Invalid scope")
            except (ValueError, TypeError, KeyError):
                flow.response = http.Response.make(400, b"Invalid scope")
                return
            suffix = "sit" if operation == "sit" else "buy_in/apply"
            self.target = f"/v10/texas_holdem/room/{room}/{suffix}"
            self.transport = "websocket" if operation == "sit" else "http"
            self.method = "PUT" if operation == "sit" else "POST"
            self.mode, self.fingerprint = mode, fingerprint
        elif flow.request.method != "GET":
            flow.response = http.Response.make(405, b"Method not allowed")
            return
        flow.response = json_response(
            flow, {"mode": self.mode, "timeline": self.timeline}
        )

    def matches(self, payload):
        """同时核对准确房间、PUT 方法及会话指纹，避免跨账号故障。"""
        headers = payload.get("headers", {})
        if not isinstance(headers, dict):
            return False
        authorization = headers.get("Authorization", headers.get("authorization", ""))
        if not isinstance(authorization, str):
            return False
        authorization = re.sub(r"^bearer\s+", "", authorization, flags=re.IGNORECASE)
        return (
            payload.get("path") == self.target
            and payload.get("method") == self.method
            and hashlib.sha256(authorization.encode()).hexdigest() == self.fingerprint
        )

    def record(self, **fields):
        """只记录时间、命令编号和固定分类，不记录请求头、参数或消息正文。"""
        self.timeline.append({"at": time.time(), **fields})
        self.timeline = self.timeline[-200:]

    async def request(self, flow):
        """真实 HTTP 故障只作用于带入接口，不包装成 RPC 业务响应。"""
        await super().request(flow)
        if (
            flow.response
            or self.transport != "http"
            or not is_staging(flow.request.host)
        ):
            return
        payload = {
            "path": urlsplit(flow.request.path).path,
            "method": flow.request.method,
            "headers": dict(flow.request.headers),
        }
        if not self.matches(payload):
            return
        mode = self.mode
        self.record(direction="request", mode=mode, layer="http", requestId=flow.id)
        if mode == "none":
            flow.metadata["texas-forwarded"] = True
            return
        if mode in ("disconnect", "timeout"):
            if mode == "timeout":
                await asyncio.sleep(30)
            flow.kill()
            return
        status = int(mode[-3:]) if mode.startswith("http-") else 200
        data = {"ok": False}
        if mode == "business-conflict":
            data.update(
                error_type="transaction_conflict", error_message="Transaction conflict"
            )
        flow.response = json_response(flow, data, status)
        if mode == "invalid-json":
            flow.response.content = b"not-json"
        self.record(
            direction="injected-response",
            mode=mode,
            layer="http",
            requestId=flow.id,
            status=status,
        )

    def response(self, flow):
        """只记录解除故障后已收到的真实 HTTP 状态及成功标志。"""
        if not flow.metadata.get("texas-forwarded"):
            return
        try:
            ok = flow.response.json().get("ok") is True
        except (ValueError, TypeError, AttributeError):
            ok = False
        self.record(
            direction="upstream-response",
            layer="http",
            requestId=flow.id,
            status=flow.response.status_code,
            ok=ok,
        )

    def outgoing(self, flow, message):
        """只丢弃命中的单个命令，保留同帧内的心跳和其他 RPC。"""
        forwarded = []
        for line in message.text.split("\n"):
            try:
                frame, payload, _path = parse_websocket_command(line)
            except (ValueError, TypeError, AttributeError):
                forwarded.append(line)
                continue
            if (
                self.transport != "websocket"
                or frame.get("method") != 9
                or not self.matches(payload)
            ):
                if self.target and payload.get("path") == self.target:
                    self.record(direction="scope-mismatch", layer="websocket")
                forwarded.append(line)
                continue
            if not isinstance(frame.get("id"), int):
                forwarded.append(line)
                continue
            key = (flow.id, frame["id"])
            self.record(
                direction="request",
                commandId=frame["id"],
                mode=self.mode,
                layer="websocket",
            )
            if self.mode == "none":
                self.pending[key] = True
                forwarded.append(line)
            else:
                self.inject(flow, frame["id"])
        message.content = "\n".join(forwarded).encode()
        if not forwarded:
            message.drop()

    def inject(self, flow, command):
        """按真实 WebSocket 协议注入；不把 HTTP 503 包装为业务错误。"""
        if self.mode == "disconnect":
            flow.kill()
            return
        if self.mode == "timeout":
            return  # 无响应，由真实客户端计时器超时。
        if self.mode == "invalid-json":
            reply = b"not-json"
        else:
            data = {"ok": False}
            if self.mode == "business-conflict":
                data.update(
                    error_type="transaction_conflict",
                    error_message="Transaction conflict",
                )
            reply = json.dumps({"id": command, "result": {"data": data}}).encode()
        ctx.master.commands.call("inject.websocket", flow, True, reply, True)
        self.record(
            direction="injected-response",
            commandId=command,
            mode=self.mode,
            layer="websocket",
        )

    def incoming(self, flow, message):
        """关联解除故障后的真实上游回复，明确区分注入回复。"""
        for line in message.text.split("\n"):
            try:
                frame = json.loads(line)
                key = (flow.id, frame.get("id"))
                if key not in self.pending:
                    continue
                del self.pending[key]
                data = frame.get("result", {}).get("data", {})
                self.record(
                    direction="upstream-response",
                    commandId=frame["id"],
                    layer="websocket",
                    ok=data.get("ok"),
                    errorType=data.get("error_type", data.get("error")),
                )
            except (ValueError, TypeError, AttributeError):
                continue

    def websocket_message(self, flow):
        """只处理已登记 staging 节点的文本帧，二进制和其他节点原样透传。"""
        if not is_staging(flow.request.host) or not flow.websocket:
            return
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        if message.from_client:
            self.outgoing(flow, message)
        else:
            self.incoming(flow, message)


addons = [TexasFaults()]
