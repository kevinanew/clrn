"""在本轮账号的准确 HTTP 接口注入 500–599，其余应用请求透传。"""

import hashlib
import json
import re
import time
from urllib.parse import urlsplit

from mitmproxy import http
from network_faults import NetworkFaults, json_response
from response_overrides import is_staging


class ServerErrors(NetworkFaults):
    """复用本机认证控制，只增加 HTTP 5xx 故障与脱敏请求记录。"""

    def __init__(self):
        """初始化未启用的故障，认证指纹不写入任何报告。"""
        super().__init__()
        self.scope = None
        self.enabled = False
        self.events = []

    def control(self, flow):
        """校验控制凭据与故障范围；控制响应不是应用 API 故障模拟。"""
        if urlsplit(flow.request.path).path != "/server-errors":
            return super().control(flow)
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        if flow.request.method == "POST":
            try:
                self.set_fault(json.loads(flow.request.content))
            except (ValueError, KeyError, TypeError):
                flow.response = http.Response.make(400, b"Invalid 5xx scope")
                return
        elif flow.request.method != "GET":
            flow.response = http.Response.make(405, b"Method not allowed")
            return
        flow.response = json_response(flow, {"enabled": self.enabled, "events": self.events})

    def set_fault(self, body):
        """只接受明确接口、账号指纹和整数 500–599；清除时保留恢复观测范围。"""
        if body == {"enabled": False}:
            self.enabled = False
            return
        status = body["status"]
        if type(status) is not int or not 500 <= status < 600:
            raise ValueError("Only HTTP 5xx is supported")
        if body.get("format") not in ("json", "html"):
            raise ValueError("Unsupported response format")
        if not re.fullmatch(r"/v\d+/[A-Za-z0-9_/-]+", body["path"]):
            raise ValueError("An exact versioned API path is required")
        if not re.fullmatch(r"[a-f0-9]{64}", body["fingerprint"]):
            raise ValueError("An account fingerprint is required")
        if body["method"] not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            raise ValueError("Unsupported method")
        self.scope = dict(body)
        self.enabled = True

    def matches(self, flow):
        """同时匹配真实 staging 节点、确切路径、方法及账号，放行预检。"""
        if not self.scope or not is_staging(flow.request.host):
            return False
        authorization = flow.request.headers.get("Authorization", "")
        token = re.sub(r"^bearer\s+", "", authorization, flags=re.I)
        return (
            flow.request.method == self.scope["method"]
            and urlsplit(flow.request.path).path == self.scope["path"]
            and hashlib.sha256(token.encode()).hexdigest() == self.scope["fingerprint"]
        )

    def record(self, flow, source):
        """仅保存请求关联、方法、路径和状态；不保存请求头或正文。"""
        self.events.append({
            "at": time.time(), "requestId": flow.id, "source": source,
            "method": flow.request.method, "path": urlsplit(flow.request.path).path,
            "status": flow.response.status_code,
        })
        self.events = self.events[-100:]

    async def request(self, flow):
        """仅替换命中的应用请求；恢复后同一范围继续观察真实上游。"""
        await super().request(flow)
        if flow.response or not self.matches(flow):
            return
        if not self.enabled:
            flow.metadata["server-errors-upstream"] = True
            return
        status = self.scope["status"]
        if self.scope["format"] == "json":
            flow.response = json_response(flow, {
                "ok": False, "error_type": "server_error",
                "error_message": f"Server error {status}",
            }, status)
        else:
            flow.response = http.Response.make(status, f"<h1>Server error {status}</h1>".encode(), {
                "Content-Type": "text/html", "Access-Control-Allow-Origin":
                flow.request.headers.get("Origin", "*"),
                "Access-Control-Allow-Credentials": "true", "Vary": "Origin",
            })
        self.record(flow, "injected-5xx")

    def response(self, flow):
        """故障解除后保留真实上游状态，不伪造成功响应。"""
        if flow.metadata.get("server-errors-upstream"):
            self.record(flow, "upstream")


addons = [ServerErrors()]
