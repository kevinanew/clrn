"""只截取本轮入座 RPC，经未修改网关和真实 HTTP 5xx 后原样交回客户端。"""

import asyncio
import hashlib
import json
import os
import re
import time
import urllib.request

from mitmproxy import ctx
from response_overrides import is_staging
from scenario_fixtures import parse_websocket_command
from server_errors import ServerErrors


class SitServerErrors(ServerErrors):
    """入座故障走实际网关 HTTP 入口，不伪造筹码不足或推送。"""

    def __init__(self):
        """保留真实命令编号，正常对照和恢复继续使用共享 staging。"""
        super().__init__()
        self.pending = {}

    def matches_rpc(self, flow, payload):
        """只匹配确切来源、方法、房间及已经正常登录的账号。"""
        if not self.scope or not is_staging(flow.request.host):
            return False
        authorization = next((value for key, value in payload.get("headers", {}).items()
                              if key.lower() == "authorization"), "")
        token = re.sub(r"^bearer\s+", "", authorization, flags=re.I)
        return (payload.get("method") == self.scope["method"] and payload.get("path") == self.scope["path"]
                and hashlib.sha256(token.encode()).hexdigest() == self.scope["fingerprint"])

    def gateway_reply(self, payload):
        """调用本机原版网关；客户端仅收到网关实际生成的 result。"""
        request = urllib.request.Request(os.environ["CLRN_5XX_GATEWAY_URL"] + "/_clrn/invoke",
            data=json.dumps({"status": self.scope["status"], "format": self.scope["format"],
                             "userId": self.scope["userId"], "request": payload}).encode(),
            headers={"Content-Type": "application/json", "X-CLRN-Control": os.environ["CLRN_5XX_GATEWAY_TOKEN"]})
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    def record_rpc(self, frame, payload, source, status=None, ok=None):
        """只记录本轮路径、座位、协议版本和状态，不记录认证头或响应用户资料。"""
        self.events.append({"at": time.time(), "commandId": frame["id"], "source": source,
                            "path": payload["path"], "seat": payload.get("json", {}).get("seat_number"),
                            "gatewayVersion": payload.get("version", "legacy"), "status": status, "ok": ok})
        self.events = self.events[-100:]

    async def client_frame(self, flow, frame):
        """正常入座透传，故障入座只转发本机真实网关结果。"""
        payload = frame.get("params", {}).get("data", {})
        if frame.get("method") != 9 or not self.matches_rpc(flow, payload):
            return False
        if not self.enabled:
            self.pending[(flow.id, frame["id"])] = payload
            return False
        result = await asyncio.to_thread(self.gateway_reply, payload)
        self.record_rpc(frame, payload, "gateway-5xx", result["upstreamStatus"])
        reply = {"id": frame["id"], **result["gatewayReply"]}
        ctx.master.commands.call("inject.websocket", flow, True, json.dumps(reply).encode(), True)
        return True

    def upstream_frame(self, flow, frame):
        """对照和恢复记录真正的入座 RPC 回复，不将旧协议缺失的 HTTP 状态猜成 200。"""
        payload = self.pending.pop((flow.id, frame.get("id")), None)
        if payload is None:
            return
        data = frame.get("result", {}).get("data", {})
        if isinstance(data, dict):
            body = data.get("json", data)
            self.record_rpc(frame, payload, "upstream-rpc", data.get("http_code"), body.get("ok"))

    async def websocket_message(self, flow):
        """限定本轮方法和请求后才截取；心跳、订阅及其他命令完整透传。"""
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        forward = []
        handled = False
        for line in message.text.splitlines():
            try:
                frame, _payload, _path = parse_websocket_command(line)
            except (ValueError, TypeError, AttributeError):
                forward.append(line)
                continue
            if not message.from_client:
                self.upstream_frame(flow, frame)
            if message.from_client and await self.client_frame(flow, frame):
                handled = True
            else:
                forward.append(line)
        if handled:
            message.content = "\n".join(forward).encode()
            if not forward:
                message.drop()


addons = [SitServerErrors()]
